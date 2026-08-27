import { store } from './state.js';
import { TEACHERS, FOREST_NEWS, POLAROIDS, LIVING_ESSAYS, TIMELINES } from './data.js';

let canvas, ctx, animationFrameId;
let stars = [];
let petals = [];

let isShowingMoreLetters = false;

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'fixed bottom-8 left-1/2 transform -translate-x-1/2 bg-accentOrange text-white font-myeongjo py-3 px-6 sm:px-8 rounded-full shadow-2xl z-[100] text-xs sm:text-sm tracking-wide border border-white/20 transition-all duration-500 opacity-0 scale-90 text-center w-[90%] max-w-md';
  toast.innerText = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.remove('opacity-0', 'scale-90');
    toast.classList.add('opacity-100', 'scale-100');
  }, 50);

  setTimeout(() => {
    toast.classList.remove('opacity-100', 'scale-100');
    toast.classList.add('opacity-0', 'scale-90');
    setTimeout(() => toast.remove(), 500);
  }, 4000);
}

function startPetalsAnimation() {
  const pCanvas = document.getElementById('petal-canvas');
  if (!pCanvas) return;
  const pCtx = pCanvas.getContext('2d');
  
  function resizeCanvas() {
    pCanvas.width = window.innerWidth;
    pCanvas.height = window.innerHeight;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  function createPetal() {
    return {
      x: Math.random() * pCanvas.width,
      y: -20,
      r: Math.random() * 5 + 3,
      d: Math.random() * pCanvas.width,
      opacity: 0.9,
      angle: Math.random() * 360,
      rotationSpeed: Math.random() * 2 - 1,
      speedY: Math.random() * 1.2 + 1.0,
      speedX: Math.random() * 0.8 - 0.4,
      createdAt: Date.now()
    };
  }

  for (let i = 0; i < 30; i++) {
    petals.push(createPetal());
  }

  function drawPetals() {
    pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
    const now = Date.now();
    
    petals = petals.filter(p => {
      const isAlive = (now - p.createdAt < 7500) && (p.y < pCanvas.height + 20);
      return isAlive;
    });

    petals.forEach(p => {
      pCtx.save();
      pCtx.translate(p.x, p.y);
      pCtx.rotate((p.angle * Math.PI) / 180);
      pCtx.beginPath();
      
      pCtx.ellipse(0, 0, p.r, p.r * 1.8, 0, 0, 2 * Math.PI);
      pCtx.fillStyle = `rgba(255, 255, 255, ${p.opacity})`;
      pCtx.shadowColor = 'rgba(255, 255, 255, 0.4)';
      pCtx.shadowBlur = 4;
      pCtx.fill();
      
      pCtx.strokeStyle = `rgba(229, 124, 72, ${p.opacity * 0.3})`;
      pCtx.lineWidth = 1;
      pCtx.beginPath();
      pCtx.moveTo(0, -p.r);
      pCtx.lineTo(0, p.r);
      pCtx.stroke();

      pCtx.restore();

      p.y += p.speedY;
      p.x += Math.sin(p.y / 30) * 0.8 + p.speedX;
      p.angle += p.rotationSpeed;
      
      const age = now - p.createdAt;
      if (age > 6000) {
        p.opacity = 1 - (age - 6000) / 1500;
      }
    });

    if (petals.length > 0) {
      requestAnimationFrame(drawPetals);
    } else {
      pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
    }
  }

  drawPetals();
}

function initMilkywayCanvas() {
  canvas = document.getElementById('milkyway-canvas');
  if (!canvas) return;
  ctx = canvas.getContext('2d');
  
  function resizeCanvas() {
    const parent = canvas.parentElement;
    canvas.width = parent.clientWidth;
    canvas.height = window.innerWidth < 640 ? 320 : 480;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  const userStars = store.milkywayStars || [];
  const baseCount = window.innerWidth < 640 ? 300 : 550; 
  stars = [];
  
  for (let idx = 0; idx < baseCount; idx++) {
    const theta = idx * 1.35;
    const r = (window.innerWidth < 640 ? 15 : 25) + idx * (window.innerWidth < 640 ? 0.45 : 0.85); 
    const messageSource = userStars[idx % userStars.length] || { name: "시민", text: "고결한 가르침을 마음에 기억하겠습니다." };
    
    const colors = [
      '#FFD3A3', 
      '#FAF8F5', 
      '#9EE8FF', 
      '#D1F7FF', 
      '#E9D1FF', 
      '#FFC6CE', 
      '#FCD34D', 
      '#F472B6'  
    ];
    const colorSelected = colors[idx % colors.length];

    stars.push({
      name: messageSource.name,
      text: messageSource.text,
      baseRadius: r,
      angle: theta,
      speed: 0.0003 + (1 / r) * 0.06,
      color: colorSelected,
      size: Math.random() * (window.innerWidth < 640 ? 1.8 : 2.8) + 1.0,
      twinklePhase: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.02 + Math.random() * 0.04,
      hovered: false
    });
  }

  let activeTooltip = null;

  function handleInteraction(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    let found = false;
    stars.forEach(s => {
      const curX = centerX + s.baseRadius * Math.cos(s.angle);
      const curY = centerY + s.baseRadius * Math.sin(s.angle);
      const dist = Math.hypot(mouseX - curX, mouseY - curY);

      if (dist < 15) {
        s.hovered = true;
        found = true;
        activeTooltip = {
          name: s.name,
          text: s.text,
          x: curX,
          y: curY
        };
      } else {
        s.hovered = false;
      }
    });

    if (!found) activeTooltip = null;
    canvas.style.cursor = found ? 'pointer' : 'default';
  }

  canvas.addEventListener('mousemove', (e) => {
    handleInteraction(e.clientX, e.clientY);
  });

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches[0]) {
      handleInteraction(e.touches[0].clientX, e.touches[0].clientY);
    }
  });

  function drawMilkyway() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    ctx.strokeStyle = 'rgba(229, 124, 72, 0.02)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 360; i += 4) {
      const r = i * (window.innerWidth < 640 ? 0.45 : 0.8);
      const x = centerX + r * Math.cos(i * Math.PI / 180);
      const y = centerY + r * Math.sin(i * Math.PI / 180);
      ctx.lineTo(x, y);
    }
    ctx.stroke();

    stars.forEach(s => {
      const curX = centerX + s.baseRadius * Math.cos(s.angle);
      const curY = centerY + s.baseRadius * Math.sin(s.angle);

      s.twinklePhase += s.twinkleSpeed;
      const pulseMultiplier = 0.5 + 0.5 * Math.sin(s.twinklePhase);
      const computedSize = s.hovered ? s.size * 2.2 : s.size * (0.7 + 0.5 * pulseMultiplier);
      const alphaGlow = s.hovered ? 'EE' : Math.floor(100 + 155 * pulseMultiplier).toString(16).padStart(2, '0');

      ctx.beginPath();
      const radiusGlow = computedSize * 3.8;
      const glowGrad = ctx.createRadialGradient(curX, curY, 0, curX, curY, radiusGlow);
      glowGrad.addColorStop(0, s.color + alphaGlow);
      glowGrad.addColorStop(0.4, s.color + '44');
      glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glowGrad;
      ctx.arc(curX, curY, radiusGlow, 0, 2 * Math.PI);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(curX, curY, s.hovered ? computedSize * 1.5 : computedSize * 0.65, 0, 2 * Math.PI);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();

      s.angle += s.speed;
    });

    if (activeTooltip) {
      ctx.save();
      const bubbleW = Math.min(270, canvas.width - 32);
      const bubbleH = 84;
      let bx = activeTooltip.x - bubbleW / 2;
      let by = activeTooltip.y - bubbleH - 20;

      if (bx < 10) bx = 10;
      if (bx + bubbleW > canvas.width - 10) bx = canvas.width - bubbleW - 10;
      if (by < 10) by = activeTooltip.y + 15;

      ctx.beginPath();
      ctx.roundRect(bx, by, bubbleW, bubbleH, 10);
      ctx.fillStyle = 'rgba(20, 31, 50, 0.96)';
      ctx.strokeStyle = 'rgba(229, 124, 72, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#FAF8F5';
      ctx.font = 'bold 11px Pretendard';
      ctx.fillText(`기억하는 이: ${activeTooltip.name}`, bx + 12, by + 20);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.font = '11px Nanum Myeongjo';
      
      const words = activeTooltip.text.split(' ');
      let line = '';
      let lineY = by + 38;
      for (let n = 0; n < words.length; n++) {
        let testLine = line + words[n] + ' ';
        let metrics = ctx.measureText(testLine);
        if (metrics.width > bubbleW - 24 && n > 0) {
          ctx.fillText(line, bx + 12, lineY);
          line = words[n] + ' ';
          lineY += 16;
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line, bx + 12, lineY);
      ctx.restore();
    }

    animationFrameId = requestAnimationFrame(drawMilkyway);
  }

  drawMilkyway();
}

function triggerStarFlightAnimation(senderName, messageText) {
  const flightContainer = document.createElement('div');
  flightContainer.className = 'fixed inset-0 pointer-events-none z-50 overflow-hidden';
  document.body.appendChild(flightContainer);

  const starNode = document.createElement('div');
  starNode.className = 'absolute w-3 h-3 bg-white rounded-full glow-star shadow-2xl';
  flightContainer.appendChild(starNode);

  const startX = window.innerWidth / 2;
  const startY = window.innerHeight - 80;
  const targetX = window.innerWidth / 2 + (Math.random() * 200 - 100);
  const targetY = window.innerHeight - 300; 

  starNode.style.left = `${startX}px`;
  starNode.style.top = `${startY}px`;

  let progress = 0;
  const duration = 1800; 
  const startTime = performance.now();

  function animate(time) {
    const elapsed = time - startTime;
    progress = Math.min(elapsed / duration, 1);

    const cpX = (startX + targetX) / 2 + 150; 
    const cpY = (startY + targetY) / 2 - 100;

    const t = progress;
    const x = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * cpX + t * t * targetX;
    const y = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * cpY + t * t * targetY;

    starNode.style.left = `${x}px`;
    starNode.style.top = `${y}px`;
    
    const trail = document.createElement('div');
    trail.className = 'absolute w-1.5 h-1.5 bg-accentOrange/40 rounded-full pointer-events-none';
    trail.style.left = `${x}px`;
    trail.style.top = `${y}px`;
    flightContainer.appendChild(trail);
    setTimeout(() => trail.remove(), 400);

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      store.addStar({ name: senderName, text: messageText });
      flightContainer.remove();
      showToast("소중한 진심이 전해졌습니다. 하단 공동의 은하수에 온기별이 깜빡이며 떠오릅니다.");
      
      const milkySection = document.getElementById('milkyway-anchor');
      if (milkySection) {
        milkySection.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }

  requestAnimationFrame(animate);
}

function renderView() {
  const root = document.getElementById('app-root');
  if (!root) return;

  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }

  if (store.currentHall === 'hall1') {
    document.body.className = "bg-primaryNavy text-white font-sans antialiased selection:bg-accentOrange selection:text-white transition-colors duration-700 overflow-x-hidden";
    document.getElementById('global-footer').className = "bg-black/40 border-t border-white/10 py-10 px-4 sm:px-6 relative z-10 transition-colors duration-700";
    document.getElementById('global-header').className = "fixed top-0 left-0 w-full z-50 transition-all duration-300 backdrop-blur-md border-b border-white/10 bg-primaryNavy/80";
  } else {
    document.body.className = "bg-warmSand text-textDark font-sans antialiased selection:bg-accentOrange selection:text-white transition-colors duration-700 overflow-x-hidden theme-light";
    document.getElementById('global-footer').className = "bg-stone-200 border-t border-stone-300/60 py-10 px-4 sm:px-6 relative z-10 transition-colors duration-700";
    document.getElementById('global-header').className = "fixed top-0 left-0 w-full z-50 transition-all duration-300 backdrop-blur-md border-b border-stone-200 bg-warmSand/80";
  }

  const tab1 = document.getElementById('tab-hall1');
  const tab2 = document.getElementById('tab-hall2');
  if (store.currentHall === 'hall1') {
    tab1.className = "flex-1 py-1.5 md:py-2.5 rounded-full text-xs md:text-sm font-medium tracking-wide transition-all duration-500 bg-accentOrange text-white shadow-md text-center";
    tab2.className = "flex-1 py-1.5 md:py-2.5 rounded-full text-xs md:text-sm font-medium tracking-wide transition-all duration-500 text-white/70 hover:text-white text-center";
  } else {
    tab1.className = "flex-1 py-1.5 md:py-2.5 rounded-full text-xs md:text-sm font-medium tracking-wide transition-all duration-500 text-stone-600 hover:text-stone-900 text-center";
    tab2.className = "flex-1 py-1.5 md:py-2.5 rounded-full text-xs md:text-sm font-medium tracking-wide transition-all duration-500 bg-deepForest text-white shadow-md text-center";
  }

  const container = document.createElement('div');
  container.className = "view-transition-enter";
  
  if (store.currentHall === 'hall1') {
    if (store.selectedTeacherId) {
      renderIndividualTeacherView(container, store.selectedTeacherId);
    } else {
      renderHall1MainView(container);
    }
  } else {
    renderHall2MainView(container);
  }

  root.innerHTML = '';
  root.appendChild(container);

  setTimeout(() => {
    container.classList.add('view-transition-active');

    if (store.currentHall === 'hall1' && !store.selectedTeacherId) {
      initMilkywayCanvas();
    }
    refreshIcons();
  }, 50);
}

function renderHall1MainView(container) {
  container.innerHTML = `
    <!-- CINEMATIC INTRODUCTION TRANSITION SCREEN -->
    <section class="min-h-[75vh] md:min-h-[85vh] flex flex-col items-center justify-center text-center px-4 py-8 relative overflow-hidden bg-gradient-to-b from-primaryNavy via-primaryNavy to-cardNavy/80">
      <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(229,124,72,0.06),transparent_70%)]"></div>
      
      <div class="relative z-10 max-w-4xl mx-auto space-y-6 md:space-y-8 delicate-float px-2">
        <div class="inline-flex items-center space-x-2 bg-white/5 border border-white/10 px-3 py-1 md:px-4 md:py-1.5 rounded-full text-[10px] md:text-xs text-accentOrange tracking-widest uppercase">
          <span>사단법인 교사유가족협의회 디지털 추모관</span>
        </div>
        
        <h1 class="font-myeongjo text-xl sm:text-2xl md:text-5xl font-bold leading-relaxed text-white max-w-3xl mx-auto break-keep">
          "사람은 두 번 떠난다고 합니다.<br class="md:hidden">세상에서 한 번, 기억에서 한 번.<br>두 번째 이별은 없습니다."
        </h1>
        
        <p class="font-myeongjo text-xs sm:text-sm md:text-lg text-white/70 max-w-2xl mx-auto leading-relaxed md:leading-loose break-keep">
          별이 된 그대들을 마음 깊이 기억하며, 우리는 오늘을 다시 살아갈 힘을 얻습니다. <br class="hidden sm:inline">
          어둠 속에 머물던 슬픔이 따뜻한 기억으로 피어날 때까지, 우리는 늘 이 자리에서 동행하겠습니다.
        </p>

        <!-- Dynamic Counter Display -->
        <div class="inline-block bg-cardNavy/70 backdrop-blur border border-white/10 rounded-2xl px-5 py-4 md:px-8 md:py-5 shadow-2xl">
          <p class="text-[10px] md:text-xs text-accentOrange font-medium tracking-wider mb-2">기억의 밤하늘을 수놓은 온기</p>
          <div class="flex items-center justify-center space-x-1.5 md:space-x-2">
            <span class="w-2.5 h-2.5 md:w-3.5 md:h-3.5 bg-accentOrange rounded-full animate-ping absolute"></span>
            <span class="w-2.5 h-2.5 md:w-3.5 md:h-3.5 bg-accentOrange rounded-full relative"></span>
            <span class="font-myeongjo text-xl md:text-3xl font-extrabold text-white tracking-widest pl-2" id="live-star-counter">${store.starCount}</span>
            <span class="text-xs md:text-sm text-white/80 font-light">개의 온기별이 빛나고 있습니다</span>
          </div>
        </div>
      </div>

      <div class="absolute bottom-6 left-1/2 transform -translate-x-1/2 text-center text-white/40 space-y-1.5">
        <span class="text-[10px] md:text-xs tracking-widest block font-light">✨ 아래로 스크롤하여 별빛 만나기</span>
        <div class="w-4 h-7 md:w-5 md:h-8 border border-white/20 rounded-full mx-auto p-1 flex justify-center">
          <div class="w-1 md:w-1.5 h-1.5 md:h-2 bg-white/60 rounded-full animate-bounce"></div>
        </div>
      </div>
    </section>

    <!-- SECTION 2: REMEMBERING TEACHERS GRID -->
    <section class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
      <div class="text-center max-w-3xl mx-auto mb-12 md:mb-16 space-y-3 md:space-y-4">
        <h2 class="font-myeongjo text-2xl md:text-4xl font-bold text-white tracking-wide">기억하는 선생님들</h2>
        <p class="text-white/60 font-light text-xs md:text-base break-keep">한 분 한 분의 이름을 가만히 눌러 따뜻한 이야기를 만나보세요.</p>
        <div class="w-12 h-[1px] bg-accentOrange/30 mx-auto mt-3"></div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
        ${TEACHERS.map(teacher => `
          <div class="bg-cardNavy border border-white/10 rounded-2xl p-5 md:p-6 hover:border-accentOrange/50 transition-all duration-500 cursor-pointer group shadow-xl hover:shadow-2xl hover:shadow-accentOrange/5 flex flex-col justify-between min-h-[380px] md:min-h-[420px]" onclick="window.viewDetails('${teacher.id}')">
            <div>
              <!-- Header Badges -->
              <div class="flex items-center justify-between mb-4 md:mb-6">
                <span class="bg-softPink text-red-800 text-[10px] md:text-xs font-semibold px-2.5 py-0.5 md:px-3 md:py-1 rounded-full border border-red-200/20">${teacher.region}</span>
                <span class="text-[10px] md:text-xs text-white/50 tracking-wider font-light">${teacher.period}</span>
              </div>

              <!-- Cover Placeholder / SVG Line-art -->
              <div class="w-full h-36 md:h-44 bg-primaryNavy rounded-xl flex flex-col items-center justify-center p-3 text-center border border-white/5 group-hover:border-white/10 transition-colors overflow-hidden relative">
                <img src="${teacher.illustration}" alt="${teacher.name}" class="absolute inset-0 w-full h-full object-cover opacity-65 group-hover:scale-105 transition-transform duration-700">
                <div class="absolute inset-0 bg-gradient-to-t from-cardNavy via-transparent to-transparent"></div>
                <div class="relative z-10 space-y-1">
                  <i data-lucide="image" class="w-5 h-5 mx-auto text-accentOrange/80 group-hover:scale-110 transition-transform"></i>
                  <span class="text-[10px] text-white/40 block">따뜻한 교단을 기억하며</span>
                </div>
              </div>

              <!-- Teacher Info -->
              <h3 class="font-myeongjo text-xl md:text-2xl font-bold text-white mt-4 md:mt-6 group-hover:text-accentOrange transition-colors">${teacher.name}</h3>
              <p class="font-myeongjo text-xs md:text-sm text-white/70 italic mt-2 line-clamp-2 leading-relaxed break-keep">"${teacher.quote}"</p>
            </div>
            
            <div class="border-t border-white/10 pt-4 mt-4 md:mt-6 flex items-center justify-between text-[10px] md:text-xs">
              <span class="text-white/40">생애 연도: ${teacher.birthYear} - ${teacher.deathYear}</span>
              <span class="text-accentOrange group-hover:underline flex items-center space-x-1">
                <span>추모관 입장</span>
                <i data-lucide="arrow-right-circle" class="w-3 h-3 md:w-3.5 md:h-3.5"></i>
              </span>
            </div>
          </div>
        `).join('')}
      </div>
    </section>

    <!-- SECTION 3: SHARED MILKYWAY INTERACTIVE CANVAS -->
    <section id="milkyway-anchor" class="bg-gradient-to-b from-cardNavy to-primaryNavy py-16 md:py-20 px-4 relative">
      <div class="max-w-4xl mx-auto text-center space-y-4 md:space-y-6 mb-8 md:mb-12">
        <span class="inline-block bg-softPink text-red-800 text-[10px] md:text-xs font-semibold px-3 py-1 rounded-full">우리 모두의 하늘</span>
        <h2 class="font-myeongjo text-2xl md:text-4xl font-bold text-white">공동의 은하수</h2>
        <p class="font-myeongjo text-white/80 leading-relaxed text-xs md:text-base max-w-2xl mx-auto break-keep">
          "우리가 보낸 그리움의 문장들이 모여, 어두운 밤을 건너는 은하수가 됩니다."<br>
          개별 별무리를 터치하거나 조용히 올려보시면 시민들의 아름다운 대화들을 읽어보실 수 있습니다.
        </p>
      </div>

      <!-- Canvas Box Wrapper -->
      <div class="max-w-5xl mx-auto bg-black/50 border border-white/10 rounded-2xl overflow-hidden relative shadow-2xl">
        <canvas id="milkyway-canvas" class="w-full block"></canvas>
        <div class="absolute bottom-3 left-3 right-3 flex flex-col sm:flex-row items-center justify-between text-[9px] md:text-xs text-white/40 gap-2 border-t border-white/5 pt-3">
          <span class="break-keep text-center sm:text-left">* 밤하늘 속 은하수 별들을 손가락으로 가볍게 터치해 소중한 진심들을 만나보세요.</span>
          <span class="bg-accentOrange/10 border border-accentOrange/30 text-accentOrange px-2.5 py-0.5 rounded-full whitespace-nowrap" id="canvas-stars-count">풍성하게 수놓인 별빛 연결됨</span>
        </div>
      </div>
    </section>

    <!-- SECTION 4: FOREST NEWS BOARD -->
    <section class="max-w-5xl mx-auto px-4 py-16 md:py-20 space-y-8 md:space-y-12">
      <div class="flex items-center space-x-3">
        <i data-lucide="bell" class="w-5 h-5 md:w-6 md:h-6 text-accentOrange"></i>
        <h2 class="font-myeongjo text-xl md:text-3xl font-bold text-white">기억의 숲 소식</h2>
      </div>

      <div class="space-y-4 md:space-y-6">
        ${FOREST_NEWS.map(news => `
          <div class="bg-cardNavy border border-white/10 rounded-xl p-5 md:p-6 hover:bg-cardNavy/80 transition-colors flex flex-col md:flex-row gap-3 md:gap-4 items-start">
            <span class="bg-accentOrange/20 text-accentOrange border border-accentOrange/30 text-[10px] md:text-xs font-bold px-2.5 py-1 rounded-lg whitespace-nowrap">${news.tag}</span>
            <div class="space-y-1.5 md:space-y-2">
              <h3 class="font-myeongjo text-base md:text-lg font-bold text-white hover:text-accentOrange transition-colors break-keep">${news.title}</h3>
              <p class="text-xs md:text-sm text-white/60 leading-relaxed break-keep">${news.desc}</p>
            </div>
          </div>
        `).join('')}
      </div>
    </section>
  `;

  window.viewDetails = (teacherId) => {
    isShowingMoreLetters = false; 
    store.selectTeacher(teacherId);
  };
}

function renderIndividualTeacherView(container, teacherId) {
  const teacher = TEACHERS.find(t => t.id === teacherId);
  if (!teacher) {
    store.selectTeacher(null);
    return;
  }

  const filteredLetters = store.letters.filter(l => l.teacherId === teacher.id);
  const lettersToShow = isShowingMoreLetters ? filteredLetters : filteredLetters.slice(0, 6);

  container.innerHTML = `
    <!-- Top Back Navigation -->
    <div class="max-w-7xl mx-auto px-4 pt-6">
      <button onclick="window.goBackToMain()" class="inline-flex items-center space-x-2 text-white/60 hover:text-accentOrange transition-colors text-xs md:text-sm font-medium">
        <i data-lucide="arrow-left" class="w-3.5 h-3.5"></i>
        <span>메인 추모관으로 가기</span>
      </button>
    </div>

    <!-- PART 1: TOP INTRO HERO PROFILE -->
    <section class="max-w-5xl mx-auto px-4 py-12 md:py-16 text-center space-y-6 md:space-y-8">
      <span class="text-[10px] md:text-xs font-light text-accentOrange tracking-wider delicate-float block">그리운 사람의 따뜻한 눈빛을 기억하며</span>
      
      <h2 class="font-myeongjo text-lg sm:text-2xl md:text-4xl font-semibold leading-relaxed text-white break-keep px-2">
        "${teacher.quote}"
      </h2>

      <!-- Visual Altar Sketch Illustration -->
      <div class="relative max-w-2xl mx-auto h-64 sm:h-80 md:h-[380px] rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-gradient-to-b from-cardNavy to-primaryNavy flex items-center justify-center p-4">
        <img src="${teacher.illustration}" alt="${teacher.name}" class="absolute inset-0 w-full h-full object-cover opacity-70">
        <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent"></div>
        <div class="absolute bottom-4 text-center w-full px-4">
          <p class="text-[10px] md:text-xs text-white/50 tracking-widest font-light break-keep">아침 햇살이 가만히 머무는 선생님의 빈 자리</p>
        </div>
      </div>

      <div class="space-y-3">
        <h1 class="font-myeongjo text-2xl md:text-5xl font-extrabold text-white">${teacher.name}</h1>
        <div class="flex items-center justify-center space-x-2 md:space-x-3 text-accentOrange text-xs md:text-sm tracking-widest">
          <span class="h-[1px] w-6 md:w-8 bg-accentOrange/40"></span>
          <span>${teacher.birthYear} — ${teacher.deathYear}</span>
          <span class="h-[1px] w-6 md:w-8 bg-accentOrange/40"></span>
        </div>
      </div>

      <div class="max-w-2xl mx-auto font-myeongjo text-white/80 leading-relaxed md:leading-loose text-left bg-cardNavy/40 border border-white/5 p-5 md:p-8 rounded-xl text-xs md:text-base space-y-4 break-keep">
        <p>${teacher.bioShort}</p>\n        <p class="border-t border-white/5 pt-4">${teacher.bioLong}</p>
      </div>
    </section>

    <!-- PART 2: LETTERS FROM LOVED ONES -->
    <section class="bg-gradient-to-b from-primaryNavy via-cardNavy to-primaryNavy py-16 md:py-24 px-4">
      <div class="max-w-5xl mx-auto space-y-10 md:space-y-12">
        <div class="text-center space-y-2 md:space-y-3">
          <span class="inline-block bg-accentOrange/10 border border-accentOrange/30 text-accentOrange text-[10px] md:text-xs px-2.5 py-0.5 md:px-3 md:py-1 rounded-full">✉ 기억의 편지</span>
          <h2 class="font-myeongjo text-2xl md:text-3xl font-bold text-white">그리움이 보내온 따뜻한 서신</h2>
          <p class="text-[10px] md:text-sm text-white/60 break-keep">봉투를 누르면 아날로그 질감의 편지가 열려, 선생님의 곁을 지키던 소중한 이들의 마음을 전해 들을 수 있습니다.</p>
        </div>

        <!-- Letters Grid with Interactive Reveal -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-6 md:gap-8" id="letters-container">
          ${lettersToShow.map(letter => `
            <div class="bg-white text-textDark rounded-2xl p-6 md:p-8 relative shadow-xl hover:-translate-y-1.5 transition-all duration-300 cursor-pointer flex flex-col justify-between min-h-[260px] md:min-h-[300px] border border-stone-200" onclick="window.openLetterModal('${letter.id}')">
              <!-- Top bar -->
              <div>
                <div class="flex items-center justify-between mb-4 md:mb-6">
                  <span class="${letter.tagColor} text-[10px] md:text-xs font-bold px-2.5 py-0.5 rounded-full">${letter.type}의 편지</span>
                  <i data-lucide="${letter.icon}" class="w-3.5 h-3.5 ${letter.locked ? 'text-gray-400' : 'text-accentOrange'}"></i>
                </div>
                
                <h3 class="font-myeongjo text-base md:text-lg font-bold ${letter.locked ? 'blur-sm select-none text-stone-400' : 'text-stone-800'} break-keep">${letter.title}</h3>
                <p class="text-xs md:text-sm text-stone-500 font-light mt-2.5 leading-relaxed line-clamp-3 break-keep ${letter.locked ? 'blur-md select-none' : ''}">${letter.preview}</p>
              </div>

              <!-- Footer meta -->
              <div class="border-t border-stone-100 pt-3 mt-4 md:mt-6 flex items-center justify-between text-[10px] md:text-xs text-stone-400">
                <span>${letter.author}</span>
                <span class="underline hover:text-accentOrange text-stone-600 font-medium">
                  ${letter.locked ? '잠금 상태 🔒' : '열기 ↗'}
                </span>
              </div>
            </div>
          `).join('')}
        </div>

        <!-- Dynamic Show More Button -->
        ${filteredLetters.length > 6 ? `
          <div class="text-center pt-4">
            <button class="bg-white/5 border border-white/15 px-5 py-2 rounded-full text-xs hover:bg-white/10 transition-colors text-white" onclick="window.toggleShowMoreLetters()">
              ${isShowingMoreLetters ? '서신 접어두기 ↩' : `그리움의 서신 더보기 (${filteredLetters.length - 6}개 존재) ↗`}
            </button>
          </div>
        ` : ''}
      </div>
    </section>

    <!-- PART 3: WRITE LETTER FORM -->
    <section class="max-w-4xl mx-auto px-4 py-8 md:py-12">
      <div class="bg-cardNavy border border-white/10 rounded-2xl p-6 md:p-12 space-y-6 md:space-y-8">
        <div class="flex items-center justify-between border-b border-white/10 pb-4">
          <div class="flex items-center space-x-2 md:space-x-3">
            <i data-lucide="pen-tool" class="text-accentOrange w-5 h-5 md:w-6 md:h-6"></i>
            <h3 class="font-myeongjo text-lg md:text-xl font-bold text-white">나만의 서신 작성하기</h3>
          </div>
          <span class="text-[10px] md:text-xs text-white/40 font-light whitespace-nowrap">마음의 조각을 남기다</span>
        </div>

        <form id="write-letter-form" class="space-y-5 md:space-y-6" onsubmit="window.submitCustomLetter(event, '${teacher.id}')">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-5 md:gap-6">
            <div class="space-y-1.5">
              <label class="text-xs text-white/60 block">보내는 이 (필명)</label>
              <input type="text" id="form-author" required placeholder="그리운 마음으로" class="w-full bg-primaryNavy/80 border-b border-white/20 focus:border-accentOrange outline-none py-2 text-xs md:text-sm text-white transition-all">
            </div>
            <div class="space-y-1.5">
              <label class="text-xs text-white/60 block">서신의 주제 (제목)</label>
              <input type="text" id="form-title" required placeholder="어느 겨울날의 약속" class="w-full bg-primaryNavy/80 border-b border-white/20 focus:border-accentOrange outline-none py-2 text-xs md:text-sm text-white transition-all">
            </div>
          </div>

          <!-- Upload Polaroid Mimic -->
          <div class="space-y-1.5">
            <label class="text-xs text-white/60 block">따뜻한 기억이 담긴 이미지 첨부 (선택)</label>
            <div class="border-2 border-dashed border-white/10 rounded-xl p-4 md:p-6 text-center hover:border-accentOrange/50 transition-colors cursor-pointer" onclick="document.getElementById('letter-photo-input').click()">
              <input type="file" id="letter-photo-input" class="hidden" accept="image/*" onchange="window.handleLetterPhotoUpload(event)">
              <div class="space-y-2" id="photo-upload-placeholder">
                <i data-lucide="camera" class="w-6 h-6 md:w-8 md:h-8 text-white/30 mx-auto"></i>\n                <p class="text-[10px] md:text-xs text-white/40">이미지를 터치하여 파일 선택하기</p>
              </div>
              <div id="photo-upload-preview" class="hidden">
                <img id="preview-img" class="max-h-36 md:max-h-40 mx-auto rounded-lg shadow-lg" alt="Upload Preview">
                <p class="text-[10px] text-accentOrange mt-2">사진이 성공적으로 임시 첨부되었습니다.</p>
              </div>
            </div>
          </div>

          <!-- Main Writing Area -->
          <div class="space-y-1.5">
            <label class="text-xs text-white/60 block">서신 내용</label>
            <textarea id="form-content" required rows="5" placeholder="이곳에 그대의 서신을 적어내려 가세요..." class="w-full bg-primaryNavy/80 border border-white/10 focus:border-accentOrange/60 rounded-xl outline-none p-3.5 md:p-4 text-xs md:text-sm text-white leading-relaxed tracking-wide"></textarea>
          </div>

          <div class="text-right">
            <button type="submit" class="bg-accentOrange hover:bg-orange-600 text-white font-medium px-6 py-2.5 md:px-8 md:py-3 rounded-xl transition-all shadow-lg active:scale-95 text-xs md:text-sm inline-flex items-center space-x-2">
              <span>서신 발송하기 ↗</span>
            </button>
          </div>
        </form>
      </div>
    </section>

    <!-- PART 4: POLAROID PHOTO GRID (선생님의 어느 하루) -->
    <section class="max-w-5xl mx-auto px-4 py-16 md:py-20 space-y-10 md:space-y-12"> 
      <div class="text-center space-y-2 md:space-y-3">
        <span class="inline-block bg-white/5 border border-white/10 text-white/70 text-[10px] md:text-xs px-2.5 py-0.5 md:px-3 md:py-1 rounded-full">📷 선생님의 어느 하루</span>
        <h2 class="font-myeongjo text-2xl md:text-3xl font-bold text-white">선생님의 다정한 하루와 흔적들</h2>
        <p class="text-xs md:text-sm text-white/60 max-w-xl mx-auto leading-relaxed break-keep">
          선생님이 살아생전 사랑했던 따뜻한 교실과 일상의 정물들을 아날로그 폴라로이드 스타일로 큐레이션 하였습니다.
        </p>
      </div>

      <!-- Polaroid Grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8 pt-4">
        ${POLAROIDS.map((pol, idx) => {
          const rotationAngle = (idx % 2 === 0 ? -1 : 1) * (idx + 1) * 0.35;
          return `
            <div class="polaroid-container bg-white p-3.5 pb-6 border border-stone-200 cursor-pointer max-w-xs mx-auto w-full transition-transform duration-300" style="transform: rotate(${rotationAngle}deg);" onclick="window.openPolaroidViewer('${pol.img}', '${pol.caption}', '${pol.detail}')">
              <div class="w-full h-44 bg-stone-100 overflow-hidden relative mb-3">
                <img src="${pol.img}" alt="${pol.caption}" class="w-full h-full object-cover">
              </div>
              <p class="font-myeongjo text-center text-stone-700 font-bold text-xs md:text-sm tracking-wide mt-2 break-keep">${pol.caption}</p>
            </div>
          `;
        }).join('')}
      </div>

      <!-- PHOTO SUBMIT CTA -->
      <div class="text-center pt-6">
        <button class="bg-accentOrange/10 border border-accentOrange/30 text-accentOrange font-medium px-5 py-2.5 rounded-full hover:bg-accentOrange hover:text-white transition-all text-xs md:text-sm" onclick="window.openSubmitPhotoModal()">
          📷 관리자에게 선생님 사진 전송하기
        </button>
      </div>
    </section>

    <!-- PART 5: INTERACTIVE OFFERING -->
    <section class="bg-cardNavy border-y border-white/10 py-16 md:py-24 px-4">
      <div class="max-w-4xl mx-auto text-center space-y-8 md:space-y-12">
        <div class="space-y-3 md:space-y-4">
          <span class="inline-block bg-accentOrange/20 border border-accentOrange/30 text-accentOrange text-[10px] md:text-xs px-2.5 py-0.5 md:px-3 md:py-1 rounded-full">✨ 기억의 은하수</span>
          <h2 class="font-myeongjo text-2xl md:text-3xl font-bold text-white">별빛에 담아 보내는 마음</h2>
          <p class="text-xs md:text-sm text-white/60 max-w-lg mx-auto leading-relaxed break-keep">
            하얀 국화 한 송이를 헌화하거나, 그리움을 가득 담은 편지를 적어주세요.<br>
            전해진 진심은 밤하늘 은하수를 영원히 유영하는 고결한 별빛이 됩니다.
          </p>
        </div>

        <!-- Altar Action Block -->
        <div class="bg-primaryNavy/80 border border-white/10 rounded-2xl p-5 md:p-12 space-y-6 md:space-y-8 max-w-xl mx-auto shadow-2xl">
          <button onclick="window.triggerFlowerPetals()" class="pulse-glow-button w-full bg-gradient-to-r from-stone-100 to-amber-50 hover:from-white hover:to-amber-100 text-textDark font-myeongjo font-bold py-4 px-4 rounded-xl transition-all duration-300 flex items-center justify-center space-x-2 group active:scale-95 text-xs sm:text-sm">
            <span class="text-lg">✿</span>
            <span>하얀 국화 한 송이 헌화하기</span>
            <span class="text-[9px] sm:text-xs font-light text-stone-500 group-hover:text-stone-700 pl-1">(화면 꽃잎 흩날림)</span>
          </button>

          <div class="flex items-center justify-center space-x-3">
            <span class="h-[1px] w-full bg-white/10"></span>
            <span class="text-[9px] md:text-xs text-white/30 whitespace-nowrap tracking-wider font-mono">OR SEND A LETTER</span>
            <span class="h-[1px] w-full bg-white/10"></span>
          </div>

          <div class="space-y-4 text-left">
            <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1.5">
              <span class="text-xs md:text-sm text-white/80 font-medium">선생님께 띄우는 마음 편지</span>
              <input type="text" id="offering-sender" placeholder="작성자 성함" class="w-full sm:w-auto bg-cardNavy border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-accentOrange outline-none">
            </div>
            
            <div class="relative">
              <textarea id="offering-message" maxlength="150" rows="3" oninput="window.updateCharCount(this)" placeholder="선생님께 닿기를 바라는 소중한 진심의 한 문장을 적어주세요. (최대 150자)" class="w-full bg-cardNavy border border-white/15 focus:border-accentOrange rounded-xl outline-none p-3 text-xs text-white leading-relaxed"></textarea>
              <div class="absolute bottom-2.5 right-2.5 text-[9px] text-white/40 font-mono">
                <span id="char-counter">0</span> / 150
              </div>
            </div>

            <button onclick="window.submitStarToGalaxy()" class="w-full bg-accentOrange hover:bg-orange-600 text-white py-2.5 md:py-3 rounded-xl transition-all shadow-md text-xs font-semibold flex items-center justify-center space-x-1">
              <i data-lucide="send" class="w-3 h-3"></i>\n              <span>은하수로 별 보내기</span>
            </button>
          </div>
        </div>

        <div class="inline-block bg-white/5 border border-white/10 rounded-2xl px-4 py-2 max-w-md">
          <p class="text-[10px] md:text-xs text-white/50 leading-relaxed break-keep">ⓘ 밤하늘 위를 떠도는 다정한 별들에 마우스를 올려보세요. 사람들의 소중한 편지들을 읽을 수 있습니다.</p>
        </div>
      </div>
    </section>
  `;

  window.toggleShowMoreLetters = () => {
    isShowingMoreLetters = !isShowingMoreLetters;
    renderView();
  };

  window.goBackToMain = () => {
    store.selectTeacher(null);
  };

  window.handleLetterPhotoUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        document.getElementById('photo-upload-placeholder').classList.add('hidden');
        document.getElementById('photo-upload-preview').classList.remove('hidden');
        document.getElementById('preview-img').src = e.target.result;
      };
      reader.readAsDataURL(file);
    }
  };

  window.submitCustomLetter = (event, tId) => {
    event.preventDefault();
    const author = document.getElementById('form-author').value;
    const title = document.getElementById('form-title').value;
    const content = document.getElementById('form-content').value;

    const newLetter = {
      id: "letter-user-" + Date.now(),
      teacherId: tId,
      type: "시민",
      tagColor: "bg-mintGreen text-emerald-800",
      icon: "pen-tool",
      title: title,
      preview: content.length > 80 ? content.substring(0, 80) + '...' : content,
      author: `시민 참배객 ${author} 로부터`,
      fontStyle: "font-typewriter",
      content: content,
      locked: false
    };

    store.addLetter(newLetter);
    showToast("감사합니다. 당신의 따뜻한 서신이 우편함 상단에 즉시 등록되었습니다.");
    renderView();
  };

  window.openLetterModal = (letterId) => {
    const letter = store.letters.find(l => l.id === letterId);
    if (!letter) return;
    if (letter.locked) {
      showToast("이 봉투는 스승의 날에 유가족 협의회의 사전 동의를 거쳐 경건히 봉인이 해제됩니다.");
      return;
    }

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[200] p-4 overflow-y-auto';
    modal.innerHTML = `
      <div class="letter-paper w-[94%] sm:w-11/12 md:w-2/3 max-w-xl rounded-2xl overflow-hidden shadow-2xl border border-stone-300 text-textDark transform scale-95 transition-all duration-300 my-auto">
        <div class="p-6 md:p-10 space-y-4 md:space-y-6 bg-warmSand max-h-[85vh] overflow-y-auto">
          <div class="flex items-start justify-between">
            <span class="text-[9px] md:text-[10px] uppercase tracking-widest text-stone-400 font-mono">기억의 숲 헌정우편</span>
            <div class="w-12 h-12 md:w-14 md:h-14 border-2 border-stone-400 rounded-lg flex items-center justify-center font-serif text-[9px] md:text-[10px] text-stone-500 rotate-6 flex-col">
              <span>기억</span>
              <span>FOREST</span>
            </div>
          </div>

          <div class="space-y-3 border-b border-stone-200 pb-4">
            <span class="text-xs text-stone-500 font-semibold">[ 발신인: ${letter.author} ]</span>
            <h4 class="font-myeongjo text-lg md:text-2xl font-bold text-stone-800 leading-tight break-keep">${letter.title}</h4>
          </div>

          <div class="notebook-lines font-myeongjo text-xs md:text-sm text-stone-700 whitespace-pre-wrap leading-relaxed pr-2">
            ${letter.content}
          </div>

          <div class="flex justify-end pt-4 border-t border-stone-100">
            <button onclick="this.closest('.fixed').remove()" class="bg-stone-800 text-white font-medium px-5 py-2 rounded-lg text-xs hover:bg-stone-900 transition-colors">
              우편 봉투 닫기
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => {
      modal.querySelector('.letter-paper').classList.remove('scale-95');
    }, 50);
  };

  window.openPolaroidViewer = (imgUrl, caption, detail) => {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[200] p-4 overflow-y-auto';
    modal.innerHTML = `
      <div class="bg-white p-4 pb-8 rounded-lg w-[94%] sm:w-11/12 max-w-md shadow-2xl border border-stone-300 text-stone-800 text-center transform scale-95 transition-transform duration-300 my-auto">
        <div class="relative w-full h-56 sm:h-72 bg-stone-100 mb-4 overflow-hidden rounded">
          <img src="${imgUrl}" class="w-full h-full object-cover" alt="Polaroid View">
        </div>
        <h4 class="font-myeongjo text-lg font-bold mb-2 break-keep">${caption}</h4>
        <p class="text-xs text-stone-500 font-light max-w-sm mx-auto leading-relaxed break-keep">${detail}</p>
        <button onclick="this.closest('.fixed').remove()" class="mt-5 text-xs text-stone-400 hover:text-stone-700 underline font-medium block mx-auto">
          닫기 (X)
        </button>
      </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => {
      modal.querySelector('.transform').classList.remove('scale-95');
    }, 50);
  };

  window.openSubmitPhotoModal = () => {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[200] p-4 overflow-y-auto';
    modal.innerHTML = `
      <div class="bg-cardNavy border border-white/20 w-[94%] sm:w-11/12 max-w-md rounded-2xl p-5 md:p-6 text-white space-y-4 md:space-y-6 my-auto">
        <div class="flex justify-between items-center border-b border-white/10 pb-3">
          <h3 class="font-myeongjo text-base md:text-lg font-bold">선생님 사진 전송하기</h3>
          <button onclick="this.closest('.fixed').remove()" class="text-white/40 hover:text-white"><i data-lucide="x" class="w-5 h-5"></i></button>
        </div>
        
        <p class="text-[11px] md:text-xs text-white/60 leading-relaxed break-keep">선생님과 아이들이 함께 보냈던 고결한 기록 사진이나 교단에서의 흔적을 사단법인 교사유가족협의회에 제보해 주시면 검토 후 우아하게 등록해 드립니다.</p>

        <div class="space-y-3">
          <input type="text" placeholder="제보자 성함/관계" class="w-full bg-primaryNavy border border-white/10 rounded-lg p-2.5 text-xs outline-none focus:border-accentOrange text-white">
          <div class="border-2 border-dashed border-white/10 rounded-xl p-5 text-center hover:border-accentOrange/30 transition-colors cursor-pointer">
            <i data-lucide="upload-cloud" class="w-6 h-6 text-white/30 mx-auto mb-2"></i>\n            <span class="text-xs text-white/40 block">업로드할 이미지 선택하기</span>
          </div>
        </div>

        <button onclick="this.closest('.fixed').remove(); showToast('제보해 주신 소중한 사진이 관리자 데이터센터로 정성껏 전송되었습니다.')" class="w-full bg-accentOrange py-2.5 md:py-3 rounded-lg text-xs font-bold hover:bg-orange-600 transition-colors">
          관리자에게 즉시 전송하기 ↗
        </button>
      </div>
    `;
    document.body.appendChild(modal);
    refreshIcons();
  };

  window.updateCharCount = (textarea) => {
    const len = textarea.value.length;
    document.getElementById('char-counter').innerText = len;
  };

  window.triggerFlowerPetals = () => {
    startPetalsAnimation();
    showToast("감사의 국화 헌화로 인해, 하얀 국화꽃잎이 화면 가득 찬란히 흩날립니다.");
  };

  window.submitStarToGalaxy = () => {
    const sender = document.getElementById('offering-sender').value || "무명별";
    const msg = document.getElementById('offering-message').value;

    if (!msg || msg.trim() === '') {
      showToast("메시지 내용을 1자 이상 기록해 주십시오.");
      return;
    }

    triggerStarFlightAnimation(sender, msg);
    
    document.getElementById('offering-message').value = '';
    document.getElementById('char-counter').innerText = '0';
  };
}

function renderHall2MainView(container) {
  container.innerHTML = `
    <!-- MAIN HERO HEADER FOR HALL II -->
    <section class="max-w-6xl mx-auto px-4 py-12 md:py-16 text-center space-y-4 md:space-y-6">
      <span class="inline-block bg-deepForest/10 text-deepForest text-[10px] md:text-xs font-bold px-3.5 py-1.5 rounded-full">🌱 오늘의 이야기</span>
      <h1 class="font-myeongjo text-2xl sm:text-3xl md:text-5xl font-extrabold text-textDark tracking-wide leading-relaxed break-keep px-2">
        그날 이후의 시간을,<br class="md:hidden">유가족들이 함께 살아내고 있습니다
      </h1>
      <p class="text-xs md:text-base text-stone-600 max-w-2xl mx-auto leading-relaxed md:leading-loose break-keep">
        슬픔의 깊은 터널을 건너, 남겨진 서로의 체온을 모으며 일상의 따뜻한 빛을 찾아가는 유가족분들의 정직한 극복 수기입니다. 아래 이야기를 선택해 고결한 마음을 함께 나누어 보세요.
      </p>
      <div class="w-10 h-[2px] bg-deepForest/40 mx-auto"></div>
    </section>

    <!-- SECTION 1: PHOTO ESSAYS -->
    <section class="max-w-5xl mx-auto px-4 pb-12 grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12">
      ${LIVING_ESSAYS.map(essay => `
        <div class="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-500 cursor-pointer flex flex-col justify-between" onclick="window.openEssayModal('${essay.id}')">
          <div class="w-full h-52 sm:h-60 bg-stone-100 overflow-hidden relative">
            <img src="${essay.img}" alt="${essay.title}" class="w-full h-full object-cover hover:scale-105 transition-transform duration-700">
            <span class="absolute top-3 left-3 bg-white/90 text-deepForest font-bold text-[10px] md:text-xs px-2.5 py-1 rounded shadow">${essay.tag}</span>
          </div>

          <div class="p-6 md:p-8 space-y-3">
            <p class="text-[10px] md:text-xs text-stone-400 font-semibold">${essay.author}</p>
            <h3 class="font-myeongjo text-lg md:text-xl font-bold text-stone-800 break-keep">${essay.title}</h3>
            <p class="font-myeongjo text-stone-600 text-xs md:text-sm italic leading-relaxed break-keep">"${essay.quote}"</p>
          </div>

          <div class="bg-stone-50 p-4 md:p-5 border-t border-stone-100 flex items-center justify-between text-xs text-stone-500 font-medium">
            <span>우린 요즘 이렇게 살고 있어요</span>
            <span class="text-deepForest flex items-center space-x-1 hover:underline">
              <span>이야기 읽기 →</span>
            </span>
          </div>
        </div>
      `).join('')}
    </section>

    <!-- WARM DISCOVERY & CONNECTION SECTION FOR FAMILIES -->
    <section class="max-w-4xl mx-auto px-4 py-8 md:py-12 mb-8 md:mb-12">
      <div class="bg-gradient-to-tr from-[#EAF4F0] to-[#FAF8F5] border border-deepForest/20 rounded-2xl p-6 md:p-12 text-center space-y-4 md:space-y-6 shadow-xl">
        <span class="inline-block bg-deepForest text-white text-[10px] md:text-[11px] font-semibold px-3.5 py-1 rounded-full tracking-wider">온기 어린 연결</span>
        <h2 class="font-myeongjo text-lg md:text-2xl font-bold text-stone-800 leading-relaxed break-keep">
          "아직 서로의 온기가 닿지 못한 또 다른 우리에게"
        </h2>
        <p class="text-xs md:text-sm text-stone-600 max-w-2xl mx-auto leading-relaxed md:leading-loose font-light break-keep">
          슬픔 속에서 홀로 길을 찾고 있을 또 다른 가족의 손을 잡을 수 있도록,<br class="hidden sm:inline">
          당사자이시거나 곁에서 아픔을 지켜보는 분이 있다면 따뜻한 마음의 제보와 소식을 기다립니다.
        </p>
        <div class="pt-2">
          <button onclick="window.openFamilyConnectModal()" class="pulse-glow-button inline-flex items-center space-x-2 bg-deepForest hover:bg-emerald-900 text-white font-myeongjo font-bold px-6 py-3.5 md:px-8 md:py-4 rounded-full transition-all duration-300 shadow-md active:scale-95 text-xs md:text-sm">
            <i data-lucide="mail" class="w-3.5 h-3.5"></i>
            <span>마음 잇기 제보하기</span>
          </button>
        </div>
      </div>
    </section>

    <!-- SECTION 2: INTERACTIVE TIMELINE -->
    <section class="bg-stone-100 border-y border-stone-200 py-16 md:py-24 px-4">
      <div class="max-w-5xl mx-auto space-y-12 md:space-y-16">
        <div class="text-center space-y-3 md:space-y-4">
          <span class="inline-block bg-deepForest/10 text-deepForest text-[10px] md:text-xs font-bold px-3 py-1.5 rounded-full">🤝 서로의 손을 잡고 건넌 시간들</span>
          <h2 class="font-myeongjo text-2xl md:text-3xl font-bold text-textDark">우리가 함께 놓은 온기의 징검다리</h2>
          <p class="text-xs md:text-sm text-stone-500 max-w-xl mx-auto leading-relaxed break-keep">우리가 함께 걸어온 발자국은 외로운 눈물이 아닌, 서로를 일으켜 세우는 연대와 희망의 역사였습니다. 징검다리를 하나씩 누르면 상세 스토리와 가족들의 감동 수기 모달을 읽으실 수 있습니다.</p>
        </div>

        <div class="relative max-w-2xl mx-auto border-l-2 border-stone-300 pl-6 md:pl-10 space-y-12 md:space-y-16">
          ${TIMELINES.map(timeline => `
            <div class="relative group cursor-pointer" onclick="window.openTimelineModal('${timeline.id}')">
              <div class="absolute -left-[30px] md:-left-[49px] top-1 bg-warmSand border-4 border-deepForest w-5 h-5 md:w-6 md:h-6 rounded-full group-hover:scale-125 transition-transform duration-300 flex items-center justify-center shadow">
                <div class="w-1 md:w-1.5 h-1 md:h-1.5 bg-accentOrange rounded-full"></div>
              </div>

              <div class="space-y-2">
                <div class="flex flex-col sm:flex-row sm:items-center space-y-1 sm:space-y-0 sm:space-x-3">
                  <span class="text-xs font-bold text-deepForest tracking-widest uppercase font-mono">${timeline.date}</span>
                  <span class="bg-stone-200 text-stone-600 text-[9px] md:text-[10px] font-semibold px-2 py-0.5 rounded w-max">${timeline.category}</span>
                </div>
                <h3 class="font-myeongjo text-base md:text-xl font-bold text-stone-800 group-hover:text-deepForest transition-colors break-keep">${timeline.title}</h3>
                <p class="text-xs md:text-sm text-stone-500 leading-relaxed font-light break-keep">${timeline.desc}</p>
                <span class="text-xs text-stone-400 font-semibold group-hover:text-deepForest underline block pt-1">자세한 스토리와 유가족 고백 보기 +</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>

    <!-- SECTION 3: SUPPORT & DONATION CALL TO ACTION -->
    <section id="donation-section" class="max-w-4xl mx-auto px-4 py-16 md:py-24 text-center space-y-10 md:space-y-12">
      <div class="space-y-3 md:space-y-4">
        <div class="w-10 h-10 md:w-12 md:h-12 bg-softPink rounded-full flex items-center justify-center mx-auto shadow">
          <i data-lucide="heart" class="w-5 h-5 md:w-6 md:h-6 text-red-600 fill-current"></i>
        </div>
        <h2 class="font-myeongjo text-2xl md:text-3xl font-bold text-textDark">남은 이야기를 끝까지 함께해 주세요</h2>
        <p class="text-xs md:text-sm text-stone-600 max-w-2xl mx-auto leading-relaxed md:leading-loose break-keep">
          그늘진 마음에 마침내 부드러운 햇살이 가득 닿을 때까지, 우리의 따뜻한 동행은 멈추지 않아야 합니다.<br>
          유가족 한 분 한 분이 아픔을 딛고 주체적인 삶으로 건강하게 돌아갈 수 있도록 온기를 더해주세요. 보내주신 소중한 후원금은 오직 세 가지 회복 사업에 투명하고 책임감 있게 전액 사용됩니다.
        </p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 text-left">
        <div class="bg-white border border-stone-200 rounded-2xl p-5 md:p-6 shadow-sm hover:shadow-md transition-shadow">
          <div class="w-9 h-9 bg-orange-100 rounded-full flex items-center justify-center mb-3 text-accentOrange">
            <i data-lucide="user-check" class="w-4.5 h-4.5"></i>
          </div>
          <h4 class="font-myeongjo text-sm md:text-base font-bold text-stone-800 mb-1.5">마음을 보듬는 심리상담</h4>
          <p class="text-[11px] md:text-xs text-stone-500 leading-relaxed break-keep">갑작스러운 슬픔이 마음의 깊은 병이 되지 않도록, 유가족 맞춤형 1:1 트라우마 치료 및 전문 상담 비용으로 사용됩니다.</p>
        </div>

        <div class="bg-white border border-stone-200 rounded-2xl p-5 md:p-6 shadow-sm hover:shadow-md transition-shadow">
          <div class="w-9 h-9 bg-amber-100 rounded-full flex items-center justify-center mb-3 text-amber-700">
            <i data-lucide="scale" class="w-4.5 h-4.5"></i>
          </div>
          <h4 class="font-myeongjo text-sm md:text-base font-bold text-stone-800 mb-1.5">외롭지 않은 법률 동행</h4>
          <p class="text-[11px] md:text-xs text-stone-500 leading-relaxed break-keep">절차적 번거로움과 억울함 앞에 좌절하는 유가족을 위하여 법률 변론, 행정 지원 및 존엄 옹호 활동 전반에 사용됩니다.</p>
        </div>

        <div class="bg-white border border-stone-200 rounded-2xl p-5 md:p-6 shadow-sm hover:shadow-md transition-shadow col-span-1 sm:col-span-2 md:col-span-1">
          <div class="w-9 h-9 bg-red-50 rounded-full flex items-center justify-center mb-3 text-red-400">
            <i data-lucide="sparkles" class="w-4.5 h-4.5"></i>
          </div>
          <h4 class="font-myeongjo text-sm md:text-base font-bold text-stone-800 mb-1.5">일상 회복 프로그램</h4>
          <p class="text-[11px] md:text-xs text-stone-500 leading-relaxed break-keep">자조모임 '봄바람', 힐링 캠프, 추모 전시 등 유가족과 사회가 다시 건강하게 연결될 수 있도록 돕는 연대 프로그램에 쓰입니다.</p>
        </div>
      </div>

      <div class="pt-4">
        <button onclick="window.openDonationModal()" class="pulse-glow-button inline-flex items-center space-x-2 bg-gradient-to-r from-deepForest to-emerald-800 hover:from-deepForest/90 hover:to-emerald-900 text-white font-myeongjo font-bold px-8 py-4 rounded-full transition-all duration-300 shadow-xl active:scale-95 text-sm md:text-lg">
          <span>💛 유가족의 일상 회복에 힘 보태기</span>
        </button>
      </div>
    </section>
  `;

  window.openFamilyConnectModal = () => {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[200] p-4 text-textDark overflow-y-auto';
    modal.innerHTML = `
      <div class="bg-warmSand border border-stone-200 w-[94%] sm:w-11/12 md:w-2/3 max-w-lg rounded-2xl p-5 md:p-8 space-y-4 md:space-y-6 shadow-2xl text-stone-800 transform scale-95 transition-all duration-300 max-h-[90vh] overflow-y-auto my-auto">
        <div class="flex justify-between items-center border-b border-stone-200 pb-3">
          <h3 class="font-myeongjo text-base md:text-lg font-bold text-deepForest">💌 마음 잇기 제보 / 연락</h3>
          <button onclick="this.closest('.fixed').remove()" class="text-stone-400 hover:text-stone-700"><i data-lucide="x" class="w-5 h-5"></i></button>
        </div>

        <p class="text-[11px] md:text-xs text-stone-500 leading-relaxed break-keep">
          홀로 아파하고 계실 또 다른 유가족분들의 소중한 제보와 연결을 기다립니다. 작성해주신 내용은 사무국에서 정성껏 확인하며, 철저한 비밀 보장을 원칙으로 조심스럽게 다가가겠습니다.
        </p>

        <form id="family-connect-form" class="space-y-4" onsubmit="window.submitFamilyConnection(event)">
          <div class="space-y-1.5">
            <label class="text-[11px] md:text-xs text-stone-500 font-bold block">제보자 이름 / 관계</label>\n            <input type="text" id="report-sender" required placeholder="예: 홍길동 / 동료교사, 고인의 동생 등" class="w-full bg-white border border-stone-300 rounded-lg p-2.5 text-xs outline-none focus:border-deepForest">
          </div>

          <div class="space-y-1.5">
            <label class="text-[11px] md:text-xs text-stone-500 font-bold block">닿고자 하는 유가족 분의 성함 혹은 상황 정보</label>
            <input type="text" id="report-target" required placeholder="예: 슬픔을 겪고 계신 고 김○○ 선생님의 가족 소식" class="w-full bg-white border border-stone-300 rounded-lg p-2.5 text-xs outline-none focus:border-deepForest">
          </div>

          <div class="space-y-1.5">
            <label class="text-[11px] md:text-xs text-stone-500 font-bold block">소중한 소식을 전해줄 연락처 (이메일/연락처)</label>
            <input type="text" id="report-contact" required placeholder="예: 010-0000-0000 / memory@school.or.kr" class="w-full bg-white border border-stone-300 rounded-lg p-2.5 text-xs outline-none focus:border-deepForest">
          </div>

          <div class="space-y-1.5">
            <label class="text-[11px] md:text-xs text-stone-500 font-bold block">전하고 싶은 마음이나 사연</label>
            <textarea id="report-story" required rows="3" placeholder="고인이 되신 소중한 선생님의 사명이나 유가족분들이 처한 상황, 남기고 싶은 말씀들을 자유롭게 적어주세요." class="w-full bg-white border border-stone-300 rounded-lg p-2.5 text-xs outline-none focus:border-deepForest leading-relaxed"></textarea>
          </div>

          <div class="bg-stone-100 p-3 rounded-lg border border-stone-200">
            <p class="text-[9px] md:text-[10px] text-stone-500 leading-relaxed font-light break-keep">
              ※ 사단법인 교사유가족협의회는 제공해주신 모든 개인정보와 연결 내용을 엄격히 비밀로 유지하며, 동의 없이 제3자에게 제공하거나 공개하지 않습니다.
            </p>
          </div>

          <button type="submit" class="w-full bg-deepForest hover:bg-emerald-950 text-white py-3 rounded-xl text-xs font-bold transition-all shadow flex items-center justify-center space-x-2">
            <i data-lucide="send" class="w-3.5 h-3.5"></i>
            <span>마음의 소식 전하기</span>
          </button>
        </form>
      </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => {
      modal.querySelector('.transform').classList.remove('scale-95');
    }, 50);
    refreshIcons();
  };

  window.submitFamilyConnection = (event) => {
    event.preventDefault();
    const modal = event.target.closest('.fixed');
    if (modal) {
      modal.remove();
      
      const successModal = document.createElement('div');
      successModal.className = 'fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[200] p-4 text-textDark';
      successModal.innerHTML = `
        <div class="bg-white border border-stone-200 w-[94%] sm:w-11/12 max-w-md rounded-2xl p-6 md:p-8 text-center space-y-4 md:space-y-6 shadow-2xl transform scale-95 transition-all duration-300 my-auto">
          <div class="w-12 h-12 md:w-16 md:h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto text-deepForest">
            <i data-lucide="sparkles" class="w-6 h-6 md:w-8 md:h-8"></i>
          </div>
          <h3 class="font-myeongjo text-base md:text-lg font-bold text-stone-800">소식이 안전하게 도착했습니다</h3>
          <p class="text-[11px] md:text-xs text-stone-600 leading-relaxed max-w-sm mx-auto font-light break-keep">
            전해주신 마음의 소식이 <strong>사단법인 교사유가족협의회</strong>에 따뜻하게 도착했습니다. 홀로 깊은 밤을 견디는 유가족이 없도록, 소중한 끈이 되어 귀하게 닿겠습니다.
          </p>
          <button onclick="this.closest('.fixed').remove()" class="w-full bg-deepForest text-white py-2.5 md:py-3 rounded-xl text-xs font-bold hover:bg-emerald-950 transition-colors">
            따뜻한 동행에 합류하기
          </button>
        </div>
      `;
      document.body.appendChild(successModal);
      setTimeout(() => {
        successModal.querySelector('.transform').classList.remove('scale-95');
      }, 50);
      refreshIcons();
    }
  };

  window.openEssayModal = (essayId) => {
    const essay = LIVING_ESSAYS.find(e => e.id === essayId);
    if (!essay) return;

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[200] p-4 text-textDark overflow-y-auto';
    modal.innerHTML = `
      <div class="bg-warmSand w-[94%] sm:w-11/12 md:w-2/3 max-w-2xl rounded-2xl overflow-hidden shadow-2xl border border-stone-200 transform scale-95 transition-all duration-300 max-h-[85vh] overflow-y-auto my-auto">
        <div class="p-5 md:p-8 space-y-5 md:space-y-6">
          <div class="flex items-center justify-between border-b border-stone-200 pb-3 md:pb-4">
            <span class="text-[10px] md:text-xs font-bold text-deepForest bg-deepForest/10 px-2.5 py-1 rounded-full">${essay.tag}</span>
            <button onclick="this.closest('.fixed').remove()" class="text-stone-400 hover:text-stone-700"><i data-lucide="x" class="w-5 h-5"></i></button>
          </div>

          <div class="relative w-full h-44 sm:h-64 md:h-72 rounded-xl overflow-hidden bg-stone-100">
            <img src="${essay.img}" class="w-full h-full object-cover" alt="Essay Cover">
          </div>

          <div class="space-y-3 md:space-y-4">
            <p class="text-[10px] md:text-xs text-stone-500 font-semibold">${essay.author}</p>
            <h3 class="font-myeongjo text-lg md:text-2xl font-bold text-stone-800 leading-tight break-keep">${essay.title}</h3>
            <div class="p-3 md:p-4 bg-stone-100 border-l-4 border-deepForest rounded-r-lg">
              <p class="font-myeongjo text-xs md:text-sm italic text-stone-700 leading-relaxed break-keep">${essay.quote}</p>
            </div>
            <p class="font-myeongjo text-stone-600 text-xs md:text-base leading-relaxed md:leading-loose whitespace-pre-line break-keep">${essay.desc}</p>
          </div>

          <!-- Quick Submission Form -->
          <div class="bg-stone-50 border border-stone-200 rounded-xl p-4 md:p-6 space-y-3">
            <h4 class="font-myeongjo text-xs md:text-sm font-bold text-stone-800">✍ 유가족 일상 이야기 제보</h4>
            <p class="text-[10px] md:text-xs text-stone-500 break-keep">여러분의 따뜻한 요즘 일상이나 복귀 수기를 이곳에 제보해주시면, 관리자의 승인을 거쳐 메인 페이지에 정성껏 추가해 드립니다.</p>\n            <textarea placeholder="요즘 저희 가족은 이렇게 살아가고 있습니다..." class="w-full p-2.5 bg-white border border-stone-300 rounded-lg text-xs outline-none focus:border-deepForest" rows="3"></textarea>
            <div class="text-right">
              <button onclick="this.closest('.fixed').remove(); showToast('소중한 사연이 성공적으로 제보되었습니다. 검토 후 우아하게 반영하겠습니다.')" class="bg-deepForest text-white px-3.5 py-1.5 rounded-lg text-xs hover:bg-emerald-950 transition-colors">제보 제출하기</button>
            </div>
          </div>

          <div class="flex justify-end pt-3 border-t border-stone-200">
            <button onclick="this.closest('.fixed').remove()" class="bg-deepForest text-white px-5 py-2 rounded-xl text-xs hover:bg-emerald-950 transition-colors">
              닫기 (X)
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => {
      modal.querySelector('.transform').classList.remove('scale-95');
    }, 50);
    refreshIcons();
  };

  window.openTimelineModal = (timelineId) => {
    const timeNode = TIMELINES.find(t => t.id === timelineId);
    if (!timeNode) return;

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[200] p-4 text-textDark overflow-y-auto';
    modal.innerHTML = `
      <div class="bg-white w-[94%] sm:w-11/12 max-w-lg rounded-2xl p-5 md:p-8 space-y-4 md:space-y-6 shadow-2xl border border-stone-200 my-auto">
        <div class="flex justify-between items-center border-b border-stone-100 pb-3">
          <span class="text-xs font-bold text-deepForest">${timeNode.date}</span>
          <button onclick="this.closest('.fixed').remove()" class="text-stone-400 hover:text-stone-700"><i data-lucide="x" class="w-5 h-5"></i></button>
        </div>

        <div class="space-y-3.5">
          <span class="bg-stone-200 text-stone-600 text-[9px] md:text-[10px] font-bold px-2.5 py-1 rounded-full">${timeNode.category}</span>
          <h3 class="font-myeongjo text-base md:text-xl font-bold text-stone-800 leading-tight break-keep">${timeNode.title}</h3>
          <p class="text-xs md:text-sm text-stone-600 leading-relaxed break-keep">${timeNode.desc}</p>
          <div class="bg-stone-50 border border-stone-200 rounded-xl p-3.5 md:p-4 space-y-1.5">
            <h4 class="text-[11px] md:text-xs font-bold text-deepForest">상세 연대 보고 및 유가족 극복기록:</h4>
            <p class="text-[10px] md:text-xs text-stone-500 leading-relaxed whitespace-pre-line break-keep">${timeNode.detailStory}</p>
          </div>
        </div>

        <button onclick="this.closest('.fixed').remove()" class="w-full bg-deepForest text-white py-2.5 md:py-3 rounded-lg text-xs font-bold hover:bg-emerald-950 transition-colors">
          확인 후 닫기
        </button>
      </div>
    `;
    document.body.appendChild(modal);
    refreshIcons();
  };

  window.openDonationModal = () => {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[200] p-4 text-textDark overflow-y-auto';
    modal.innerHTML = `
      <div class="bg-warmSand border border-stone-200 w-[94%] sm:w-11/12 max-w-md rounded-2xl p-5 md:p-8 space-y-4 md:space-y-6 shadow-2xl text-stone-800 my-auto">
        <div class="flex justify-between items-center border-b border-stone-200 pb-3">
          <h3 class="font-myeongjo text-base md:text-lg font-bold text-deepForest">💛 따뜻한 일상 회복 후원</h3>
          <button onclick="this.closest('.fixed').remove()" class="text-stone-400 hover:text-stone-700"><i data-lucide="x" class="w-5 h-5"></i></button>
        </div>

        <p class="text-[11px] md:text-xs text-stone-500 leading-relaxed break-keep">사단법인 교사유가족협의회에 보내주시는 따뜻한 마음은 투명한 심리치료비, 법률 동행비, 자조모임 자립 기금으로 직접 전액 집행됩니다.</p>

        <div class="space-y-4">
          <div class="space-y-1">
            <label class="text-[11px] md:text-xs text-stone-500 font-bold block">후원 지정 프로그램 선택</label>
            <select class="w-full bg-white border border-stone-300 rounded-lg p-2.5 text-xs outline-none focus:border-deepForest">
              <option>마음을 보듬는 심리상담 프로젝트</option>\n              <option>외롭지 않은 전담 법률 지원단 동행</option>
              <option>자조모임 '봄바람' 및 유가족 힐링 프로그램</option>
            </select>
          </div>

          <div class="space-y-1">
            <label class="text-[11px] md:text-xs text-stone-500 font-bold block">후원 금액 설정</label>
            <div class="grid grid-cols-3 gap-1.5">
              <button class="bg-white border border-stone-300 rounded-lg py-2 text-xs text-stone-600 hover:bg-deepForest hover:text-white transition-colors" onclick="document.getElementById('custom-donation-amount').value = '10000'">1만 원</button>
              <button class="bg-white border border-stone-300 rounded-lg py-2 text-xs text-stone-600 hover:bg-deepForest hover:text-white transition-colors" onclick="document.getElementById('custom-donation-amount').value = '30000'">3만 원</button>
              <button class="bg-white border border-stone-300 rounded-lg py-2 text-xs text-stone-600 hover:bg-deepForest hover:text-white transition-colors" onclick="document.getElementById('custom-donation-amount').value = '50000'">5만 원</button>
            </div>
            <input type="number" id="custom-donation-amount" placeholder="직접 기재할 후원 금액" class="w-full bg-white border border-stone-300 rounded-lg p-2.5 text-xs outline-none focus:border-deepForest mt-2">
          </div>
        </div>

        <button onclick="this.closest('.fixed').remove(); showToast('유가족의 밝은 안식을 위한 소중한 후원이 완료되었습니다. 머리 숙여 깊은 감사를 전합니다.')" class="w-full bg-deepForest text-white py-3 rounded-xl text-xs font-bold hover:bg-emerald-950 transition-colors shadow">
          지정 금액 투명 후원하기 ↗
        </button>
      </div>
    `;
    document.body.appendChild(modal);
    refreshIcons();
  };
}

function setupEventListeners() {
  document.getElementById('tab-hall1').addEventListener('click', () => {
    store.switchHall('hall1');
  });

  document.getElementById('tab-hall2').addEventListener('click', () => {
    store.switchHall('hall2');
  });

  document.getElementById('logo-btn').addEventListener('click', (e) => {
    e.preventDefault();
    store.selectTeacher(null);
    store.switchHall('hall1');
  });

  document.getElementById('footer-retract-btn').addEventListener('click', () => {
    showToast("철회 신청이 접수되었습니다. 유가족 협의회 사무국 담당자(02-XXX-XXXX)가 신속히 연락해 드리겠습니다.");
  });

  document.getElementById('nav-support-btn').addEventListener('click', () => {
    store.switchHall('hall2');
    setTimeout(() => {
      const section = document.getElementById('donation-section');
      if (section) {
        section.scrollIntoView({ behavior: 'smooth' });
      }
    }, 150);
  });
}

store.subscribe(() => {
  renderView();
});

document.addEventListener('DOMContentLoaded', () => {
  renderView();
  setupEventListeners();
  refreshIcons();
});
