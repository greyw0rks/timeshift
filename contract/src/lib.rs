use near_contract_standards::{
    fungible_token::receiver::FungibleTokenReceiver,
    non_fungible_token::{
        core::{NonFungibleTokenCore, NonFungibleTokenResolver},
        enumeration::NonFungibleTokenEnumeration,
        events::NftMint,
        metadata::{
            NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
        },
        NonFungibleToken, Token, TokenId,
    },
};
use near_sdk::{
    assert_one_yocto, env, ext_contract,
    json_types::{U128, U64},
    near, require, serde_json,
    store::{IterableMap, LookupMap},
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
};
use std::collections::HashMap;

const STORAGE: NearToken = NearToken::from_millinear(30);
const ONE: NearToken = NearToken::from_yoctonear(1);
const SECOND: u64 = 1_000_000_000;
const DAY: u64 = 86_400;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Active,
    Paying,
    Redeemed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Lock {
    amount: U128,
    created_at: U64,
    unlock_at: U64,
    status: Status,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Listing {
    seller: AccountId,
    price: U128,
    nonce: U64,
}

#[near(serializers = [json])]
pub struct Position {
    id: TokenId,
    owner: AccountId,
    lock: Lock,
    listing: Option<Listing>,
}

#[near(serializers = [json])]
#[serde(tag = "action", rename_all = "snake_case")]
enum Funding {
    Lock { duration: u64 },
    Buy { id: TokenId, nonce: U64 },
}

#[ext_contract(ext_ft)]
trait FungiblePayout {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[ext_contract(ext_self)]
trait Settlement {
    fn finish_redeem(&mut self, id: TokenId) -> bool;
    fn finish_withdrawal(&mut self, owner: AccountId, amount: U128) -> bool;
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Timeshift {
    asset: AccountId,
    nft: NonFungibleToken,
    locks: LookupMap<TokenId, Lock>,
    listings: IterableMap<TokenId, Listing>,
    credits: LookupMap<AccountId, u64>,
    proceeds: LookupMap<AccountId, U128>,
    transferring: LookupMap<TokenId, bool>,
    next_id: u64,
    next_nonce: u64,
}

#[near]
impl Timeshift {
    #[init]
    pub fn new(asset: AccountId) -> Self {
        Self {
            asset,
            nft: NonFungibleToken::new(
                b"n",
                env::current_account_id(),
                Some(b"m"),
                Some(b"e"),
                None::<Vec<u8>>,
            ),
            locks: LookupMap::new(b"l"),
            listings: IterableMap::new(b"s"),
            credits: LookupMap::new(b"c"),
            proceeds: LookupMap::new(b"p"),
            transferring: LookupMap::new(b"x"),
            next_id: 1,
            next_nonce: 1,
        }
    }

    pub fn asset(&self) -> AccountId {
        self.asset.clone()
    }

    #[payable]
    pub fn prepay_lock(&mut self) {
        require!(
            env::attached_deposit() == STORAGE,
            "Attach 0.03 NEAR per lock"
        );
        let owner = env::predecessor_account_id();
        let count = self.lock_credits(owner.clone());
        self.credits.insert(owner, count + 1);
    }

    pub fn lock_credits(&self, owner: AccountId) -> u64 {
        self.credits.get(&owner).copied().unwrap_or(0)
    }

    pub fn get_lock(&self, id: TokenId) -> Option<Position> {
        Some(Position {
            owner: self.nft.owner_by_id.get(&id)?,
            lock: self.locks.get(&id)?.clone(),
            listing: self.listings.get(&id).cloned(),
            id,
        })
    }

    pub fn get_listings(&self, from_index: u32, limit: u32) -> Vec<Position> {
        let end = from_index.saturating_add(limit.min(100));
        self.listings
            .keys()
            .skip(from_index as usize)
            .take((end - from_index) as usize)
            .filter_map(|id| self.get_lock(id.clone()))
            .collect()
    }

    pub fn get_locks_by_owner(
        &self,
        owner: AccountId,
        from_index: U128,
        limit: u32,
    ) -> Vec<Position> {
        self.nft
            .nft_tokens_for_owner(owner, Some(from_index), Some(limit.clamp(1, 100) as u64))
            .into_iter()
            .filter_map(|token| self.get_lock(token.token_id))
            .collect()
    }

    pub fn proceeds_of(&self, owner: AccountId) -> U128 {
        self.proceeds.get(&owner).copied().unwrap_or(U128(0))
    }

    #[payable]
    pub fn list_lock(&mut self, id: TokenId, price: U128) {
        require!(
            env::attached_deposit() == STORAGE,
            "Attach 0.03 NEAR for listing storage"
        );
        let owner = self.assert_owner(&id);
        let lock = self.active_lock(&id);
        require!(
            env::block_timestamp() < lock.unlock_at.0,
            "Lock has matured"
        );
        require!(
            price.0 > 0 && price.0 < lock.amount.0,
            "Price must be below payout and above zero"
        );
        self.listings.insert(
            id,
            Listing {
                seller: owner,
                price,
                nonce: U64(self.next_nonce),
            },
        );
        self.next_nonce += 1;
    }

    #[payable]
    pub fn cancel_listing(&mut self, id: TokenId) {
        assert_one_yocto();
        self.assert_owner(&id);
        self.listings.remove(&id);
    }

    #[payable]
    pub fn redeem(&mut self, id: TokenId) -> Promise {
        assert_one_yocto();
        let owner = self.assert_owner(&id);
        let mut lock = self.active_lock(&id);
        require!(
            env::block_timestamp() >= lock.unlock_at.0,
            "Lock has not matured"
        );
        self.listings.remove(&id);
        lock.status = Status::Paying;
        self.locks.insert(id.clone(), lock.clone());
        self.payout(owner, lock.amount).then(
            ext_self::ext(env::current_account_id())
                .with_static_gas(Gas::from_tgas(15))
                .finish_redeem(id),
        )
    }

    #[private]
    pub fn finish_redeem(&mut self, id: TokenId) -> bool {
        let success = env::promise_result_checked(0, 64).is_ok();
        let lock = self.locks.get_mut(&id).expect("Missing lock");
        require!(lock.status == Status::Paying, "No pending redemption");
        lock.status = if success {
            Status::Redeemed
        } else {
            Status::Active
        };
        success
    }

    #[payable]
    pub fn withdraw_proceeds(&mut self) -> Promise {
        assert_one_yocto();
        let owner = env::predecessor_account_id();
        let amount = self.proceeds.remove(&owner).unwrap_or(U128(0));
        require!(amount.0 > 0, "No proceeds available");
        self.payout(owner.clone(), amount).then(
            ext_self::ext(env::current_account_id())
                .with_static_gas(Gas::from_tgas(15))
                .finish_withdrawal(owner, amount),
        )
    }

    #[private]
    pub fn finish_withdrawal(&mut self, owner: AccountId, amount: U128) -> bool {
        let success = env::promise_result_checked(0, 64).is_ok();
        if !success {
            self.credit_proceeds(owner, amount);
        }
        success
    }
}

impl Timeshift {
    fn assert_owner(&self, id: &TokenId) -> AccountId {
        let caller = env::predecessor_account_id();
        require!(
            self.nft.owner_by_id.get(id).as_ref() == Some(&caller),
            "Current owner only"
        );
        caller
    }

    fn active_lock(&self, id: &TokenId) -> Lock {
        let lock = self.locks.get(id).expect("Unknown lock");
        require!(
            lock.status == Status::Active && !self.transferring.contains_key(id),
            "Lock is unavailable"
        );
        lock.clone()
    }

    fn payout(&self, owner: AccountId, amount: U128) -> Promise {
        ext_ft::ext(self.asset.clone())
            .with_attached_deposit(ONE)
            .with_static_gas(Gas::from_tgas(20))
            .ft_transfer(owner, amount, Some("TIMESHIFT settlement".into()))
    }

    fn credit_proceeds(&mut self, seller: AccountId, amount: U128) {
        let balance = self.proceeds_of(seller.clone());
        self.proceeds.insert(seller, U128(balance.0 + amount.0));
    }

    fn create_lock(&mut self, sender: AccountId, amount: U128, duration: u64) {
        require!(
            [60, 7 * DAY, 30 * DAY, 90 * DAY].contains(&duration),
            "Unsupported duration"
        );
        let credits = self.lock_credits(sender.clone());
        require!(credits > 0, "Prepay lock storage first");
        if credits == 1 {
            self.credits.remove(&sender);
        } else {
            self.credits.insert(sender.clone(), credits - 1);
        }
        let id = self.next_id.to_string();
        self.next_id += 1;
        let now = env::block_timestamp();
        self.locks.insert(
            id.clone(),
            Lock {
                amount,
                created_at: U64(now),
                unlock_at: U64(now + duration * SECOND),
                status: Status::Active,
            },
        );
        let metadata = TokenMetadata {
            title: Some(format!("TIMESHIFT Lock #{}", id)),
            ..Default::default()
        };
        self.nft
            .internal_mint_with_refund(id.clone(), sender.clone(), Some(metadata), None);
        NftMint {
            owner_id: &sender,
            token_ids: &[&id],
            memo: None,
        }
        .emit();
    }

    fn buy_lock(&mut self, buyer: AccountId, amount: U128, id: TokenId, nonce: U64) {
        let lock = self.active_lock(&id);
        let listing = self
            .listings
            .get(&id)
            .expect("Lock is no longer listed")
            .clone();
        require!(
            env::block_timestamp() < lock.unlock_at.0,
            "Lock has matured"
        );
        require!(
            listing.nonce == nonce && amount == listing.price,
            "Listing or price changed"
        );
        require!(buyer != listing.seller, "Seller cannot buy their own lock");
        self.nft.internal_transfer(
            &listing.seller,
            &buyer,
            &id,
            None,
            Some("TIMESHIFT sale".into()),
        );
        self.listings.remove(&id);
        self.credit_proceeds(listing.seller, amount);
    }
}

#[near]
impl FungibleTokenReceiver for Timeshift {
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(
            env::predecessor_account_id() == self.asset,
            "Unsupported token"
        );
        require!(amount.0 > 0, "Positive amount required");
        match serde_json::from_str(&msg).expect("Invalid funding message") {
            Funding::Lock { duration } => self.create_lock(sender_id, amount, duration),
            Funding::Buy { id, nonce } => self.buy_lock(sender_id, amount, id, nonce),
        }
        PromiseOrValue::Value(U128(0))
    }
}

#[near]
impl NonFungibleTokenCore for Timeshift {
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        self.active_lock(&token_id);
        self.nft
            .nft_transfer(receiver_id, token_id.clone(), approval_id, memo);
        self.listings.remove(&token_id);
    }

    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        self.active_lock(&token_id);
        let result =
            self.nft
                .nft_transfer_call(receiver_id, token_id.clone(), approval_id, memo, msg);
        self.listings.remove(&token_id);
        self.transferring.insert(token_id, true);
        result
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.nft.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenResolver for Timeshift {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        self.transferring.remove(&token_id);
        self.nft.nft_resolve_transfer(
            previous_owner_id,
            receiver_id,
            token_id,
            approved_account_ids,
        )
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for Timeshift {
    fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: NFT_METADATA_SPEC.into(),
            name: "TIMESHIFT Lock".into(),
            symbol: "TSLOCK".into(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }
}
