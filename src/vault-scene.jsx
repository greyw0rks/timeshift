import React, { useEffect, useRef } from "react";
import * as THREE from "three";

export default function VaultScene({ reduced }) {
  const ref = useRef(null);
  useEffect(() => {
    if (reduced) return;
    const host = ref.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); }
    catch { return; }
    host.append(renderer.domElement);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(37, 1, .1, 100);
    camera.position.set(0, 0, 7.7);
    const vault = new THREE.Group();
    vault.rotation.z = -.24;
    scene.add(vault);
    const cyan = new THREE.MeshBasicMaterial({color: 0xe4dcb4});
    const glass = new THREE.MeshBasicMaterial({color: 0xb49343, transparent: true, opacity: .32, wireframe: true});
    const points = [
      new THREE.Vector2(.03, 0), new THREE.Vector2(.15, .2),
      new THREE.Vector2(.44, .48), new THREE.Vector2(.67, .82), new THREE.Vector2(.78, 1.12),
    ];
    const chamber = new THREE.LatheGeometry(points, 32);
    for (const direction of [-1, 1]) {
      const mesh = new THREE.Mesh(chamber, glass);
      mesh.scale.y = direction;
      vault.add(mesh);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(.79, .027, 12, 64), cyan);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = direction * 1.14;
      vault.add(rim);
    }
    const orbit = new THREE.Mesh(new THREE.TorusGeometry(1.65, .005, 6, 96),
      new THREE.MeshBasicMaterial({ color: 0xe4dcb4, transparent: true, opacity: .45 }));
    orbit.rotation.set(1.19, .3, -.2);
    scene.add(orbit);
    const grainCount = 550;
    const positions = new Float32Array(grainCount * 3);
    const grains = Array.from({ length: grainCount }, (_, index) => ({
      angle: index * 2.399963, height: (index * .618033) % 1,
      radius: Math.sqrt((index * .754878) % 1),
    }));
    const grainGeo = new THREE.BufferGeometry();
    grainGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    vault.add(new THREE.Points(grainGeo, new THREE.PointsMaterial({color: 0xf4b60b, size: .042, transparent: true, opacity: .85})));
    const observer = new ResizeObserver(() => {
      const { clientWidth: width, clientHeight: height } = host;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    observer.observe(host);
    renderer.setAnimationLoop((ms) => {
      const time = ms / 1000;
      vault.rotation.y = time * .22;
      vault.position.y = .07 * Math.sin(time);
      grains.forEach(({ angle, height, radius }, index) => {
        const falling = index % 11 === 0;
        const y = falling ? .8 - ((height + time * .65) % 1) * 1.8
          : index % 2 ? .52 + height * .56 : -.60 - height * .48;
        const spread = falling ? .027 : radius * (Math.abs(y) * .71 - .04);
        positions.set([Math.cos(angle) * spread, y, Math.sin(angle) * spread], index * 3);
      });
      grainGeo.attributes.position.needsUpdate = true;
      renderer.render(scene, camera);
    });
    return () => {
      observer.disconnect();
      renderer.setAnimationLoop(null);
      const disposed = new Set();
      scene.traverse((object) => {
        for (const resource of [object.geometry, object.material]) {
          if (resource && !disposed.has(resource)) { resource.dispose(); disposed.add(resource); }
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [reduced]);
  return <div className="vault-scene" ref={ref} aria-hidden="true" />;
}
