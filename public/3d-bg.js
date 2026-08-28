// Three.js 3D Particle Background
(function() {
    // Only run if Three.js is loaded
    if (typeof THREE === 'undefined') return;
    
    const container = document.getElementById('bg-canvas');
    if (!container) return;
    
    // --- Setup Scene ---
    const scene = new THREE.Scene();
    scene.background = null; // transparent
    
    // --- Camera ---
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 30;
    
    // --- Renderer ---
    const renderer = new THREE.WebGLRenderer({ 
        antialias: true, 
        alpha: true 
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    
    // --- Particles ---
    const count = 600;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    
    // Determine color based on theme
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const accentColor = new THREE.Color(isDark ? '#5e9fe8' : '#2783de');
    const mutedColor = new THREE.Color(isDark ? '#7d7a75' : '#b0aba5');
    
    for (let i = 0; i < count; i++) {
        // Positions in a sphere
        const radius = 20 + Math.random() * 15;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos((Math.random() * 2) - 1);
        
        positions[i*3] = radius * Math.sin(phi) * Math.cos(theta);
        positions[i*3+1] = radius * Math.sin(phi) * Math.sin(theta);
        positions[i*3+2] = radius * Math.cos(phi);
        
        // Colors - blend between accent and muted
        const mix = Math.random();
        const color = accentColor.clone().lerp(mutedColor, mix);
        colors[i*3] = color.r;
        colors[i*3+1] = color.g;
        colors[i*3+2] = color.b;
        
        sizes[i] = 0.05 + Math.random() * 0.15;
    }
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    
    // --- Particle Material ---
    const material = new THREE.PointsMaterial({
        size: 0.2,
        vertexColors: true,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
        depthWrite: false
    });
    
    const particles = new THREE.Points(geometry, material);
    scene.add(particles);
    
    // --- Mouse Interaction ---
    let mouseX = 0;
    let mouseY = 0;
    let targetX = 0;
    let targetY = 0;
    
    document.addEventListener('mousemove', (event) => {
        mouseX = (event.clientX / window.innerWidth) * 2 - 1;
        mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
    });
    
    document.addEventListener('touchmove', (event) => {
        if (event.touches.length > 0) {
            mouseX = (event.touches[0].clientX / window.innerWidth) * 2 - 1;
            mouseY = -(event.touches[0].clientY / window.innerHeight) * 2 + 1;
        }
    }, { passive: true });
    
    // --- Resize ---
    function onResize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    }
    window.addEventListener('resize', onResize);
    
    // --- Theme change detection ---
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        // Reload page to update colors (simple approach)
        window.location.reload();
    });
    
    // --- Animation Loop ---
    function animate() {
        requestAnimationFrame(animate);
        
        // Smooth mouse follow
        targetX += (mouseX - targetX) * 0.05;
        targetY += (mouseY - targetY) * 0.05;
        
        // Rotate particles based on mouse
        particles.rotation.x += 0.0005 + targetY * 0.001;
        particles.rotation.y += 0.001 + targetX * 0.001;
        
        renderer.render(scene, camera);
    }
    
    animate();
})();
