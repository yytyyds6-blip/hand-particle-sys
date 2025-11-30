import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import GUI from 'lil-gui';

// --- 全局变量 ---
let scene, camera, renderer, particles, geometry, material;
let handLandmarker, video;
let lastVideoTime = -1;

let isHandDetected = false;
let pinchFactor = 0; 
let lastHandX = 0; let lastHandY = 0;
let targetRotationX = 0; let targetRotationY = 0;

// 默认常量
const DEFAULTS = {
    particleCount: 25000,
    shape: 'heart',
    particleSize: 0.12,
    color: '#e60042',
    colorMode: 'custom',
    rotateSpeed: 8.0,
    expansionSensitivity: 2.0,
    responseSpeed: 0.1
};

const shapes = {
    current: DEFAULTS.shape,
    targetPositions: null 
};

const params = {
    // 模型参数
    particleCount: DEFAULTS.particleCount,
    shape: DEFAULTS.shape,
    particleSize: DEFAULTS.particleSize,
    
    // 颜色参数
    colorMode: DEFAULTS.colorMode,
    color: DEFAULTS.color,
    gradientSpeed: 1.2,
    
    // 交互参数
    expansionSensitivity: DEFAULTS.expansionSensitivity,
    rotateSpeed: DEFAULTS.rotateSpeed, 
    responseSpeed: DEFAULTS.responseSpeed,
    showVideo: false,
    
    // 自动旋转参数
    autoRotSpeed: 0.5, 
    autoRotX: 0.0,     
    autoRotY: 1.0,     
    autoRotZ: 0.0,
    
    // --- 修复后的重置功能 (只重置数量和大小) ---
    resetModel: function() {
        // 1. 只重置数量和大小
        params.particleCount = DEFAULTS.particleCount;
        params.particleSize = DEFAULTS.particleSize;
        
        // 注意：这里不再重置 shape, color, colorMode
        
        // 2. 重建系统 (rebuildParticles 会使用当前选中的 shape)
        rebuildParticles();
    },

    resetGestures: function() {
        params.rotateSpeed = DEFAULTS.rotateSpeed;
        params.expansionSensitivity = DEFAULTS.expansionSensitivity;
        params.responseSpeed = DEFAULTS.responseSpeed;
    },

    resetAutoRot: function() {
        params.autoRotSpeed = 0.5;
        params.autoRotX = 0.0;
        params.autoRotY = 1.0;
        params.autoRotZ = 0.0;
        // 重置物理角度
        if(particles) {
            particles.rotation.set(0, 0, 0);
            targetRotationX = 0;
            targetRotationY = 0;
        }
    }
};

async function init() {
    initThree();
    initUI();
    rebuildParticles(); 
    await initHandTracking();
    
    document.getElementById('loader').style.opacity = 0;
    setTimeout(() => document.getElementById('loader').remove(), 500);
    
    animate();
}

function initThree() {
    const container = document.getElementById('canvas-container');
    
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x020202, 0.02);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 25); 

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = false; 
    controls.enablePan = false;

    const sprite = new THREE.TextureLoader().load('https://threejs.org/examples/textures/sprites/disc.png');
    material = new THREE.PointsMaterial({
        size: params.particleSize,
        map: sprite,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.9
    });

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    document.getElementById('fs-btn').addEventListener('click', () => {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen();
        else document.exitFullscreen();
    });
}

// --- 核心重建函数 ---
function rebuildParticles() {
    if (particles) {
        scene.remove(particles);
        geometry.dispose();
    }

    // 使用当前的 params.shape
    shapes.current = params.shape;
    material.size = params.particleSize;

    const count = Math.floor(params.particleCount);
    shapes.targetPositions = new Float32Array(count * 3);
    
    geometry = new THREE.BufferGeometry();
    const posArray = new Float32Array(count * 3);
    const colArray = new Float32Array(count * 3);

    for(let i=0; i<count*3; i++) {
        posArray[i] = (Math.random() - 0.5) * 60;
        colArray[i] = 1.0;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colArray, 3));

    particles = new THREE.Points(geometry, material);
    scene.add(particles);

    createShapes(params.shape);
}

function createShapes(type) {
    const count = Math.floor(params.particleCount);
    const targetPos = shapes.targetPositions;
    
    if (params.colorMode === 'custom') updateStaticColors();

    let i = 0; 
    while (i < count) {
        let x = 0, y = 0, z = 0;
        let valid = true;

        if (type === 'heart') {
            const scale = 1.2;
            let u = (Math.random() * 3 - 1.5) * scale;
            let v = (Math.random() * 3 - 1.5) * scale; 
            let w = (Math.random() * 2.5 - 1) * scale; 
            const x2 = u*u; const v2 = v*v; const w2 = w*w;
            const a = x2 + (2.25 * v2) + w2 - 1;
            const result = (a * a * a) - (x2 * (w * w * w)) - (0.1125 * v2 * (w * w * w));
            if (result <= 0) {
                x = u * 6; y = w * 6; z = v * 2.5; 
            } else { valid = false; }

        } else if (type === 'sphere') { 
            const r = 9;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            x = r * Math.sin(phi) * Math.cos(theta);
            y = r * Math.sin(phi) * Math.sin(theta);
            z = r * Math.cos(phi);
            
            if (i > count * 0.7) {
                const ringR = 12 + Math.random() * 8;
                const ringTheta = Math.random() * Math.PI * 2;
                let rx = ringR * Math.cos(ringTheta);
                let rz = ringR * Math.sin(ringTheta);
                let ry = (Math.random() - 0.5) * 0.5;
                const tilt = 0.4; 
                x = rx; 
                y = ry * Math.cos(tilt) - rz * Math.sin(tilt);
                z = ry * Math.sin(tilt) + rz * Math.cos(tilt);
            }

        } else if (type === 'flower') { 
            const spread = 0.4;
            const angle = i * 137.5 * (Math.PI / 180);
            const r = spread * Math.sqrt(i) * 0.6;
            x = r * Math.cos(angle);
            z = r * Math.sin(angle);
            y = Math.sin(r * 0.6) * 4 - 3;
        } else if (type === 'buddha') { 
            const p = Math.random();
            if (p < 0.25) { 
                const r = 2.8; const u=Math.random(), v=Math.random(); const t=2*Math.PI*u, ph=Math.acos(2*v-1);
                x = r*Math.sin(ph)*Math.cos(t); y = r*Math.sin(ph)*Math.sin(t) + 7.5; z = r*Math.cos(ph);
            } else if (p < 0.65) { 
                const r = 5.0; const u=Math.random(), v=Math.random(); const t=2*Math.PI*u, ph=Math.acos(2*v-1);
                x = r*Math.sin(ph)*Math.cos(t); y = r*Math.sin(ph)*Math.sin(t) * 1.1; z = r*Math.cos(ph);
            } else { 
                const r = 7.5; const u=Math.random(), v=Math.random(); const t=2*Math.PI*u, ph=Math.acos(2*v-1);
                x = r*Math.sin(ph)*Math.cos(t); y = r*Math.sin(ph)*Math.sin(t) * 0.4 - 4.5; z = r*Math.cos(ph);
            }
        } else if (type === 'dna') { 
            const strand = i % 2 === 0 ? 1 : -1;
            const t = (i / count) * Math.PI * 12; 
            const radius = 4;
            y = ((i / count) - 0.5) * 24;
            x = Math.cos(t + (strand * Math.PI)) * radius; z = Math.sin(t + (strand * Math.PI)) * radius;
            x += (Math.random()-0.5)*0.5; z += (Math.random()-0.5)*0.5;
        } else if (type === 'knot') { 
            const t = (i / count) * Math.PI * 2 * 3; const p = 2, q = 3; const scale = 3.2;
            const r = Math.cos(q * t) + 2;
            x = scale * r * Math.cos(p * t); z = scale * r * Math.sin(p * t); y = scale * -Math.sin(q * t);
            x += (Math.random()-0.5); y += (Math.random()-0.5); z += (Math.random()-0.5);
        } else if (type === 'galaxy') { 
            const arms = 4; const armIndex = i % arms; const r = Math.random(); const radius = r * 16;
            const spin = radius * 0.8; const armAngle = (Math.PI * 2 / arms) * armIndex; const angle = spin + armAngle;
            x = Math.cos(angle) * radius; z = Math.sin(angle) * radius;
            const h = Math.exp(-radius * 0.3) * 4; y = (Math.random() - 0.5) * h;
            x += (Math.random()-0.5)*0.5; z += (Math.random()-0.5)*0.5;
        } else if (type === 'fireworks') { 
            const r = Math.pow(Math.random(), 0.3) * 15;
            const theta = Math.random() * Math.PI * 2; const phi = Math.acos(2 * Math.random() - 1);
            x = r * Math.sin(phi) * Math.cos(theta); y = r * Math.sin(phi) * Math.sin(theta); z = r * Math.cos(phi);
        }
        if (valid) {
            const i3 = i * 3; targetPos[i3] = x; targetPos[i3 + 1] = y; targetPos[i3 + 2] = z; i++;
        }
    }
}

function updateStaticColors() {
    const count = Math.floor(params.particleCount);
    const colors = geometry.attributes.color.array;
    const colorObj = new THREE.Color(params.color);
    for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        const variance = (Math.random() - 0.5) * 0.15;
        colors[i3] = Math.min(1, Math.max(0, colorObj.r + variance));
        colors[i3 + 1] = Math.min(1, Math.max(0, colorObj.g + variance));
        colors[i3 + 2] = Math.min(1, Math.max(0, colorObj.b + variance));
    }
    geometry.attributes.color.needsUpdate = true;
}

async function initHandTracking() {
    try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numHands: 1 
        });
        video = document.getElementById('video-input');
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        await video.play();
        document.getElementById('video-input').style.display = params.showVideo ? 'block' : 'none';
    } catch (error) { console.error(error); }
}

function detectHands() {
    if (!handLandmarker || !video || video.paused) return;

    if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const results = handLandmarker.detectForVideo(video, performance.now());
        const statusEl = document.getElementById('status');

        if (results.landmarks.length > 0) {
            const landmarks = results.landmarks[0]; 
            
            const cx = (landmarks[0].x + landmarks[5].x + landmarks[17].x) / 3;
            const cy = (landmarks[0].y + landmarks[5].y + landmarks[17].y) / 3;

            if (!isHandDetected) {
                lastHandX = cx;
                lastHandY = cy;
                isHandDetected = true;
            } else {
                const deltaX = cx - lastHandX;
                const deltaY = cy - lastHandY;
                
                targetRotationY -= deltaX * params.rotateSpeed;
                targetRotationX += deltaY * params.rotateSpeed; 

                lastHandX = cx;
                lastHandY = cy;
            }

            const thumb = landmarks[4];
            const index = landmarks[8];
            const dist = Math.sqrt(Math.pow(thumb.x - index.x, 2) + Math.pow(thumb.y - index.y, 2));
            let normalized = (dist - 0.03) * 5;
            normalized = Math.max(0, Math.min(1, normalized));
            pinchFactor += (normalized - pinchFactor) * 0.1;

            statusEl.innerText = `交互中 | 移动: 旋转 | 捏合: 扩散`;
            statusEl.style.color = '#00ff88';

        } else {
            isHandDetected = false;
            pinchFactor += (0 - pinchFactor) * 0.05;
            statusEl.innerText = '观赏中 (未检测到手势)';
            statusEl.style.color = '#00d2ff';
        }
    }
}

function initUI() {
    const gui = new GUI({ title: '控制台' });
    
    // --- 1. 模型与粒子面板 ---
    const shapeFolder = gui.addFolder('模型与外观');
    // 形状
    shapeFolder.add(params, 'shape', { 
        '❤️ 饱满爱心': 'heart', '🪐 土星': 'sphere', '🌺 花朵': 'flower', 
        '🗿 佛像': 'buddha', '🧬 DNA': 'dna', '🌌 银河': 'galaxy', 
        '🍩 扭结': 'knot', '🎆 烟花': 'fireworks'
    }).name('形状').listen().onChange(val => { 
        shapes.current = val; 
        createShapes(val); 
    });
    
    // 数量和大小
    shapeFolder.add(params, 'particleCount', 5000, 50000, 1000).name('粒子数量').listen().onFinishChange(() => {
        rebuildParticles();
    });
    shapeFolder.add(params, 'particleSize', 0.01, 0.5).name('粒子大小').listen().onChange(val => material.size = val);
    
    // 恢复按钮：仅恢复数量和大小
    shapeFolder.add(params, 'resetModel').name('↺ 恢复默认参数');

    // --- 2. 颜色面板 ---
    const colorFolder = gui.addFolder('颜色特效');
    colorFolder.add(params, 'colorMode', { '固定': 'custom', '幻彩': 'rainbow' }).listen().onChange(val => {
        if (val === 'custom') updateStaticColors();
    });
    colorFolder.addColor(params, 'color').listen().onChange(() => { if (params.colorMode === 'custom') updateStaticColors(); });
    colorFolder.add(params, 'gradientSpeed', 0.1, 5.0).name('流光速度');

    // --- 3. 自动旋转面板 ---
    const autoFolder = gui.addFolder('自动旋转 (观赏模式)');
    autoFolder.add(params, 'autoRotSpeed', 0.0, 5.0).name('自动转速').listen();
    autoFolder.add(params, 'autoRotX', -1.0, 1.0).name('X轴方向').listen();
    autoFolder.add(params, 'autoRotY', -1.0, 1.0).name('Y轴方向').listen();
    autoFolder.add(params, 'autoRotZ', -1.0, 1.0).name('Z轴方向').listen();
    autoFolder.add(params, 'resetAutoRot').name('↺ 恢复初始状态');

    // --- 4. 手势面板 ---
    const ctrlFolder = gui.addFolder('手势参数');
    ctrlFolder.add(params, 'rotateSpeed', 1.0, 20.0).name('旋转力度').listen();
    ctrlFolder.add(params, 'expansionSensitivity', 0.1, 5.0).name('扩散力度').listen();
    ctrlFolder.add(params, 'responseSpeed', 0.01, 0.3).name('平滑系数').listen();
    ctrlFolder.add(params, 'showVideo').name('摄像头画面').onChange(val => {
        document.getElementById('video-input').style.display = val ? 'block' : 'none';
    });
    ctrlFolder.add(params, 'resetGestures').name('↺ 恢复默认参数');
    
    shapeFolder.open();
    autoFolder.open();
    ctrlFolder.open();
}

function animate() {
    requestAnimationFrame(animate);
    detectHands();

    const positions = geometry.attributes.position.array;
    const colors = geometry.attributes.color.array;
    const target = shapes.targetPositions;
    const count = Math.floor(params.particleCount);
    
    const time = Date.now() * 0.001;
    const tempColor = new THREE.Color();

    if (isHandDetected) {
        particles.rotation.y += (targetRotationY - particles.rotation.y) * params.responseSpeed;
        particles.rotation.x += (targetRotationX - particles.rotation.x) * params.responseSpeed;
    } else {
        const dt = 0.005; 
        particles.rotation.x += params.autoRotX * params.autoRotSpeed * dt;
        particles.rotation.y += params.autoRotY * params.autoRotSpeed * dt;
        particles.rotation.z += params.autoRotZ * params.autoRotSpeed * dt;
        
        targetRotationX = particles.rotation.x;
        targetRotationY = particles.rotation.y;
    }

    const expansionForce = pinchFactor * 25 * params.expansionSensitivity; 

    for(let i=0; i<count; i++) {
        const i3 = i*3;

        if (params.colorMode === 'rainbow') {
            const hue = (i * 0.00002 + time * params.gradientSpeed * 0.1 + positions[i3+1]*0.02) % 1;
            tempColor.setHSL(hue, 0.8, 0.6); 
            colors[i3] = tempColor.r; colors[i3+1] = tempColor.g; colors[i3+2] = tempColor.b;
        }

        let tx = target[i3]; let ty = target[i3+1]; let tz = target[i3+2];

        if (shapes.current === 'dna' || shapes.current === 'galaxy') {
            const speed = time * (shapes.current === 'dna' ? 0.6 : 0.2);
            const x0 = tx; const z0 = tz;
            tx = x0 * Math.cos(speed) - z0 * Math.sin(speed);
            tz = x0 * Math.sin(speed) + z0 * Math.cos(speed);
        }

        const dist = Math.sqrt(tx*tx + ty*ty + tz*tz) + 0.001;
        const noise = Math.sin(i * 0.5 + time) * 0.3; 
        
        const finalTx = tx + ((tx/dist) * expansionForce * (1 + noise));
        const finalTy = ty + ((ty/dist) * expansionForce * (1 + noise));
        const finalTz = tz + ((tz/dist) * expansionForce * (1 + noise));

        positions[i3] += (finalTx - positions[i3]) * params.responseSpeed;
        positions[i3+1] += (finalTy - positions[i3+1]) * params.responseSpeed;
        positions[i3+2] += (finalTz - positions[i3+2]) * params.responseSpeed;
    }

    geometry.attributes.position.needsUpdate = true;
    if (params.colorMode === 'rainbow') geometry.attributes.color.needsUpdate = true;

    renderer.render(scene, camera);
}

init();