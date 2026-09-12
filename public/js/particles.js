/**
 * 粒子效果 - 登录页背景动画
 * 鼠标跟随 + 浮动粒子
 */
class ParticleSystem {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.particles = [];
        this.mouse = { x: -1000, y: -1000 };
        this.mouseRadius = 150;
        this.particleCount = 80;
        this.running = false;

        this.resize();
        this.init();
        this.bindEvents();
    }

    resize() {
        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;
    }

    init() {
        this.particles = [];
        for (let i = 0; i < this.particleCount; i++) {
            this.particles.push(this.createParticle());
        }
    }

    createParticle() {
        const size = Math.random() * 3 + 1.5;
        return {
            x: Math.random() * this.canvas.width,
            y: Math.random() * this.canvas.height,
            vx: (Math.random() - 0.5) * 0.6,
            vy: (Math.random() - 0.5) * 0.6,
            size: size,
            baseSize: size,
            opacity: Math.random() * 0.5 + 0.2,
            color: `rgba(255, 255, 255, `,
        };
    }

    bindEvents() {
        window.addEventListener('resize', () => {
            this.resize();
        });

        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            this.mouse.x = e.clientX - rect.left;
            this.mouse.y = e.clientY - rect.top;
        });

        this.canvas.addEventListener('mouseleave', () => {
            this.mouse.x = -1000;
            this.mouse.y = -1000;
        });
    }

    update() {
        for (let p of this.particles) {
            // 移动
            p.x += p.vx;
            p.y += p.vy;

            // 边界反弹
            if (p.x < 0 || p.x > this.canvas.width) p.vx *= -1;
            if (p.y < 0 || p.y > this.canvas.height) p.vy *= -1;
            p.x = Math.max(0, Math.min(this.canvas.width, p.x));
            p.y = Math.max(0, Math.min(this.canvas.height, p.y));

            // 鼠标吸引
            const dx = this.mouse.x - p.x;
            const dy = this.mouse.y - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < this.mouseRadius) {
                const force = (1 - dist / this.mouseRadius) * 0.02;
                p.vx += dx * force;
                p.vy += dy * force;
                p.size = p.baseSize + (1 - dist / this.mouseRadius) * 3;
            } else {
                p.size += (p.baseSize - p.size) * 0.05;
            }

            // 速度限制
            const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
            if (speed > 2) {
                p.vx *= 0.98;
                p.vy *= 0.98;
            }
        }
    }

    draw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // 绘制连线
        for (let i = 0; i < this.particles.length; i++) {
            for (let j = i + 1; j < this.particles.length; j++) {
                const dx = this.particles[i].x - this.particles[j].x;
                const dy = this.particles[i].y - this.particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 120) {
                    const opacity = (1 - dist / 120) * 0.15;
                    this.ctx.beginPath();
                    this.ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
                    this.ctx.lineWidth = 0.5;
                    this.ctx.moveTo(this.particles[i].x, this.particles[i].y);
                    this.ctx.lineTo(this.particles[j].x, this.particles[j].y);
                    this.ctx.stroke();
                }
            }
        }

        // 绘制粒子
        for (let p of this.particles) {
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            this.ctx.fillStyle = p.color + p.opacity + ')';
            this.ctx.fill();
        }

        // 绘制鼠标光晕
        if (this.mouse.x > 0 && this.mouse.y > 0) {
            const gradient = this.ctx.createRadialGradient(
                this.mouse.x, this.mouse.y, 0,
                this.mouse.x, this.mouse.y, this.mouseRadius
            );
            gradient.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            this.ctx.beginPath();
            this.ctx.arc(this.mouse.x, this.mouse.y, this.mouseRadius, 0, Math.PI * 2);
            this.ctx.fillStyle = gradient;
            this.ctx.fill();
        }
    }

    animate() {
        if (!this.running) return;
        this.update();
        this.draw();
        requestAnimationFrame(() => this.animate());
    }

    start() {
        this.running = true;
        this.animate();
    }

    stop() {
        this.running = false;
    }
}

// 全局初始化
let particleSystem = null;

function initParticles() {
    const canvas = document.getElementById('particles-canvas');
    if (!canvas) return;

    particleSystem = new ParticleSystem(canvas);
    particleSystem.start();
}

function stopParticles() {
    if (particleSystem) {
        particleSystem.stop();
        particleSystem = null;
    }
}
