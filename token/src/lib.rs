use near_contract_standards::fungible_token::{
    metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC},
    FungibleToken,
};
use near_sdk::{env, json_types::U128, near, AccountId, PanicOnDefault, PromiseOrValue};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct DemoToken {
    token: FungibleToken,
}

#[near]
impl DemoToken {
    #[init]
    pub fn new() -> Self {
        Self {
            token: FungibleToken::new(b"t"),
        }
    }

    // Deliberately uncapped and intended exclusively for testnet demonstrations.
    pub fn faucet(&mut self) {
        let account = env::predecessor_account_id();
        self.token.internal_deposit(&account, 1_000_000_000);
        near_contract_standards::fungible_token::events::FtMint {
            owner_id: &account,
            amount: U128(1_000_000_000),
            memo: Some("Testnet faucet"),
        }
        .emit();
    }
}

near_contract_standards::impl_fungible_token_core!(DemoToken, token);

#[near]
impl near_contract_standards::storage_management::StorageManagement for DemoToken {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> near_contract_standards::storage_management::StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(
        &mut self,
        amount: Option<near_sdk::NearToken>,
    ) -> near_contract_standards::storage_management::StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.storage_unregister(force)
    }

    fn storage_balance_bounds(
        &self,
    ) -> near_contract_standards::storage_management::StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(
        &self,
        account_id: AccountId,
    ) -> Option<near_contract_standards::storage_management::StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for DemoToken {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.into(),
            name: "Timeshift Test Dollar".into(),
            symbol: "TUSD".into(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }
}
