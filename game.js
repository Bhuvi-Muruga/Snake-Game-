(function(){
	'use strict';

	// Share helpers
	function resolveGameUrl(){
		try{
			// If opened as a local file, keep file:// link; otherwise use current origin/path
			const loc=window.location;
			if(loc.protocol==='file:') return loc.href;
			return loc.origin+loc.pathname;
		}catch(e){ return 'index.html'; }
	}
	window.openShare=function(){
		const url=resolveGameUrl();
		const input=document.getElementById('shareUrl');
		if(input){ input.value=url; }
		const canvas=document.getElementById('qrCanvas');
		if(window.QRCode && canvas){
			// qrcode lib builds to QRCode and also QRCode.toCanvas; support either
			if(typeof window.QRCode==='object' && window.QRCode.toCanvas){ window.QRCode.toCanvas(canvas, url, {margin:1,scale:6}); }
		}
		document.getElementById('shareScreen').style.display='block';
	};
	window.closeShare=function(){ document.getElementById('shareScreen').style.display='none'; };
	window.copyLink=function(){ const input=document.getElementById('shareUrl'); if(!input) return; input.select(); input.setSelectionRange(0,99999); try{ document.execCommand('copy'); }catch(e){ navigator.clipboard?.writeText(input.value); } };

	class SnakeGame{
		constructor(){
			this.canvas=document.getElementById('gameCanvas');
			this.ctx=this.canvas.getContext('2d');
			this.gridSize=20;
			this.cols=Math.floor(this.canvas.width/this.gridSize);
			this.rows=Math.floor(this.canvas.height/this.gridSize);

			this.difficulty='easy'; // default, will be set on start
			this.resetState();
			this.setupEvents();
			this.enableTouchControls();
			this.setupResize();
			this.draw();
		}

		setupResize(){
			const resize=()=>{
				// Use device pixel ratio for crisp rendering
				const dpr=window.devicePixelRatio||1;
				const maxWidth=Math.min(600, Math.floor(document.querySelector('.game-container').clientWidth*0.95));
				const aspect= this.canvas.height/this.canvas.width; // 400/600 = 0.666
				const targetW = Math.max(300, maxWidth);
				const targetH = Math.floor(targetW*aspect);
				this.canvas.style.width=targetW+'px';
				this.canvas.style.height=targetH+'px';
				this.ctx.setTransform(1,0,0,1,0,0); // reset
			};
			window.addEventListener('resize',resize);
			resize();
		}

		resetState(){
			this.snake=[{x:Math.floor(this.cols/2),y:Math.floor(this.rows/2)}];
			this.dx=0;this.dy=0; // start stopped until Start
			this.score=0;this.level=1;this.lives=3;
			this.highScore=parseInt(localStorage.getItem('snakeHighScore')||'0',10);
			this.baseSpeedMs= this.difficulty==='hard'?120 : this.difficulty==='medium'?140 : 160;
			this.speedMs=this.baseSpeedMs;
			this.lastTick=0;
			this.gameRunning=false;this.gamePaused=false;
			this.powerUpActive=false;this.powerUpTimer=0;
			this.food=null;
			this.stones=[]; // obstacles
			this.theme='classic';
			this.fruitTypes=[
				{ name:'Apple', color:'#ff3b30', points:10, weight:30 },
				{ name:'Banana', color:'#ffd60a', points:15, weight:25 },
				{ name:'Orange', color:'#ff9f0a', points:20, weight:20 },
				{ name:'Grapes', color:'#5856d6', points:25, weight:15 },
				{ name:'Strawberry', color:'#ff2d55', points:30, weight:8 },
				{ name:'Pineapple', color:'#34c759', points:40, weight:2 },
			];
			this.placeFood();
			this.updateTheme(true);
			this.maybeSpawnStones();
			this.updateUI();
		}

		enableTouchControls(){
			const up=document.getElementById('btnUp');
			const left=document.getElementById('btnLeft');
			const down=document.getElementById('btnDown');
			const right=document.getElementById('btnRight');
			if(up){ up.addEventListener('click',()=>{ if(this.dy!==1){ this.dx=0; this.dy=-1; } }); }
			if(down){ down.addEventListener('click',()=>{ if(this.dy!==-1){ this.dx=0; this.dy=1; } }); }
			if(left){ left.addEventListener('click',()=>{ if(this.dx!==1){ this.dx=-1; this.dy=0; } }); }
			if(right){ right.addEventListener('click',()=>{ if(this.dx!==-1){ this.dx=1; this.dy=0; } }); }
			// Swipe support
			let touchStart=null;
			this.canvas.addEventListener('touchstart',(e)=>{ if(e.touches.length>0){ touchStart={x:e.touches[0].clientX, y:e.touches[0].clientY}; } },{passive:true});
			this.canvas.addEventListener('touchmove',(e)=>{ e.preventDefault(); },{passive:false});
			this.canvas.addEventListener('touchend',(e)=>{
				if(!touchStart) return;
				const touchEnd=e.changedTouches[0];
				const dx=touchEnd.clientX - touchStart.x;
				const dy=touchEnd.clientY - touchStart.y;
				if(Math.abs(dx)>Math.abs(dy)){
					if(dx>20 && this.dx!==-1){ this.dx=1; this.dy=0; }
					else if(dx<-20 && this.dx!==1){ this.dx=-1; this.dy=0; }
				}else{
					if(dy>20 && this.dy!==-1){ this.dx=0; this.dy=1; }
					else if(dy<-20 && this.dy!==1){ this.dx=0; this.dy=-1; }
				}
				touchStart=null;
			});
		}

		setupEvents(){
			document.addEventListener('keydown',(e)=>{
				if(e.code==='Space'){
					e.preventDefault();
					if(this.gameRunning){ this.togglePause(); }
					return;
				}
				if(!this.gameRunning||this.gamePaused) return;
				switch(e.code){
					case 'ArrowUp': case 'KeyW': if(this.dy!==1){this.dx=0;this.dy=-1;} break;
					case 'ArrowDown': case 'KeyS': if(this.dy!==-1){this.dx=0;this.dy=1;} break;
					case 'ArrowLeft': case 'KeyA': if(this.dx!==1){this.dx=-1;this.dy=0;} break;
					case 'ArrowRight': case 'KeyD': if(this.dx!==-1){this.dx=1;this.dy=0;} break;
				}
			});
		}

		weightedFruit(){
			const total=this.fruitTypes.reduce((s,f)=>s+f.weight,0);
			let r=Math.random()*total;
			for(const f of this.fruitTypes){ r-=f.weight; if(r<=0) return f; }
			return this.fruitTypes[0];
		}

		placeFood(){
			let f;
			do{
				f={ x:Math.floor(Math.random()*this.cols), y:Math.floor(Math.random()*this.rows), type:this.weightedFruit() };
			}while(this.snake.some(s=>s.x===f.x&&s.y===f.y) || this.stones.some(s=>s.x===f.x&&s.y===f.y));
			this.food=f;
		}

		maybeSpawnStones(){
			const base = this.difficulty==='hard' ? 6 : this.difficulty==='medium' ? 4 : 2;
			const targetCount = Math.min(30, base + Math.floor(this.level * (this.difficulty==='hard'?2:1.5)));
			while(this.stones.length < targetCount){
				const s={ x:Math.floor(Math.random()*this.cols), y:Math.floor(Math.random()*this.rows) };
				if(this.snake.some(p=>p.x===s.x&&p.y===s.y)) continue;
				if(this.food && this.food.x===s.x && this.food.y===s.y) continue;
				if(this.stones.some(p=>p.x===s.x&&p.y===s.y)) continue;
				this.stones.push(s);
			}
			if(this.stones.length > targetCount){ this.stones.length = targetCount; }
		}

		updateTheme(force=false){
			const prev=this.theme;
			if(this.level>=6){ this.theme='ice'; }
			else if(this.level>=3){ this.theme='desert'; }
			else { this.theme='classic'; }
			if(force || prev!==this.theme){
				const container=document.querySelector('.game-container');
				if(container){ container.classList.remove('theme-classic','theme-desert','theme-ice'); container.classList.add('theme-'+this.theme); }
			}
		}

		togglePause(){
			this.gamePaused=!this.gamePaused;
			document.getElementById('pauseScreen').style.display=this.gamePaused?'block':'none';
		}

		update(){
			if(!this.gameRunning||this.gamePaused) return;
			const head={ x:this.snake[0].x+this.dx, y:this.snake[0].y+this.dy };
			if(head.x<0||head.x>=this.cols||head.y<0||head.y>=this.rows){ this.loseLife(); return; }
			if(this.snake.some(seg=>seg.x===head.x&&seg.y===head.y)){ this.loseLife(); return; }
			if(this.stones.some(s=>s.x===head.x&&s.y===head.y)){ this.loseLife(); return; }
			this.snake.unshift(head);
			if(this.food && head.x===this.food.x && head.y===this.food.y){
				this.score+=this.food.type.points;
				this.level=1+Math.floor(this.score/100);
				this.speedMs=Math.max(60, this.baseSpeedMs- (this.level-1)*12 - (this.difficulty==='hard'?10:0));
				if(Math.random()<0.1){ this.powerUpActive=true; this.powerUpTimer=60; this.speedMs=Math.max(40,this.speedMs-30); document.getElementById('powerUpIndicator').style.display='block'; }
				this.placeFood();
				this.updateTheme();
				this.maybeSpawnStones();
			}else{
				this.snake.pop();
			}
			if(this.powerUpActive){ this.powerUpTimer--; if(this.powerUpTimer<=0){ this.powerUpActive=false; document.getElementById('powerUpIndicator').style.display='none'; this.speedMs=Math.max(60, this.baseSpeedMs- (this.level-1)*12); } }
			this.updateUI();
		}

		// Helpers for better-looking snake
		getDirFrom(a,b){ return {dx: Math.sign(b.x-a.x), dy: Math.sign(b.y-a.y)}; }
		drawRoundedRect(x,y,w,h,r){ const c=this.ctx; c.beginPath(); c.moveTo(x+r,y); c.lineTo(x+w-r,y); c.quadraticCurveTo(x+w,y,x+w,y+r); c.lineTo(x+w,y+h-r); c.quadraticCurveTo(x+w,y+h,x+w-r,y+h); c.lineTo(x+r,y+h); c.quadraticCurveTo(x,y+h,x,y+h-r); c.lineTo(x,y+r); c.quadraticCurveTo(x,y,x+r,y); c.fill(); }
		drawHead(seg,dir){
			const c=this.ctx, gs=this.gridSize;
			const cx=seg.x*gs+gs/2, cy=seg.y*gs+gs/2;
			// Determine facing
			let ux=dir.dx, uy=dir.dy;
			if((ux===0&&uy===0) && this.snake.length>1){ const d=this.getDirFrom(this.snake[1],this.snake[0]); ux=d.dx; uy=d.dy; }
			const ang=Math.atan2(uy,ux);
			const px=-uy, py=ux; // perpendicular
			// Capsule parameters
			const halfL=gs*0.28;
			const r=gs*0.36;
			const tipX=cx+ux*halfL, tipY=cy+uy*halfL;
			const baseX=cx-ux*halfL, baseY=cy-uy*halfL;
			// Gradient from back to front
			const grad=c.createLinearGradient(baseX,baseY, tipX,tipY);
			grad.addColorStop(0,'#3fa95a');
			grad.addColorStop(1,'#9df28f');
			c.fillStyle=grad;
			// Draw capsule snout (front arc bigger, back arc slightly smaller)
			c.beginPath();
			c.arc(tipX,tipY,r, ang-Math.PI/2, ang+Math.PI/2);
			c.arc(baseX,baseY,r*0.8, ang+Math.PI/2, ang-Math.PI/2);
			c.closePath();
			c.fill();
			c.strokeStyle='#2e7d32'; c.lineWidth=2; c.stroke();
			// Eyes
			const eyeR=2.4; const eyeOffF=gs*0.10; const eyeOffS=gs*0.18;
			const e1x=cx+ux*eyeOffF+px*eyeOffS, e1y=cy+uy*eyeOffF+py*eyeOffS;
			const e2x=cx+ux*eyeOffF-px*eyeOffS, e2y=cy+uy*eyeOffF-py*eyeOffS;
			c.fillStyle='#fff'; c.beginPath(); c.arc(e1x,e1y,eyeR,0,Math.PI*2); c.fill(); c.beginPath(); c.arc(e2x,e2y,eyeR,0,Math.PI*2); c.fill();
			c.fillStyle='#000'; c.beginPath(); c.arc(e1x,e1y,eyeR*0.45,0,Math.PI*2); c.fill(); c.beginPath(); c.arc(e2x,e2y,eyeR*0.45,0,Math.PI*2); c.fill();
			// Nostrils near tip
			const nBack=gs*0.06, nSide=gs*0.06;
			const nx=cx+ux*(halfL-nBack), ny=cy+uy*(halfL-nBack);
			c.fillStyle='#1b5e20';
			c.beginPath(); c.arc(nx+px*nSide, ny+py*nSide, 1.2, 0, Math.PI*2); c.fill();
			c.beginPath(); c.arc(nx-px*nSide, ny-py*nSide, 1.2, 0, Math.PI*2); c.fill();
		}
		drawBody(seg,index){ const c=this.ctx, gs=this.gridSize; const margin=3; const green=Math.max(60,220-index*10); c.fillStyle=`rgb(76,${green},80)`; this.drawRoundedRect(seg.x*gs+margin, seg.y*gs+margin, gs-2*margin, gs-2*margin, 4); }
		drawTail(seg,prev){ const c=this.ctx, gs=this.gridSize; const cx=seg.x*gs+gs/2, cy=seg.y*gs+gs/2; const d=this.getDirFrom(prev,seg); const ux=d.dx, uy=d.dy; const px=-uy, py=ux; const tipX=cx+ux*(gs*0.38), tipY=cy+uy*(gs*0.38); const baseX=cx-ux*(gs*0.2), baseY=cy-uy*(gs*0.2); const halfW=gs*0.22; c.fillStyle='rgb(76,120,80)'; c.beginPath(); c.moveTo(tipX,tipY); c.lineTo(baseX+px*halfW, baseY+py*halfW); c.lineTo(baseX-px*halfW, baseY-py*halfW); c.closePath(); c.fill(); }

		draw(){
			const ctx=this.ctx;
			let bg='#000', grid='#1a1a1a', stoneColor='#888';
			switch(this.theme){ case 'desert': bg='#1a1208'; grid='#3a2a18'; stoneColor='#9a8066'; break; case 'ice': bg='#021523'; grid='#0c3a66'; stoneColor='#7aa2c9'; break; }
			ctx.fillStyle=bg; ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
			ctx.strokeStyle=grid; ctx.lineWidth=0.5;
			for(let c=0;c<=this.cols;c++){ ctx.beginPath(); ctx.moveTo(c*this.gridSize,0); ctx.lineTo(c*this.gridSize,this.canvas.height); ctx.stroke(); }
			for(let r=0;r<=this.rows;r++){ ctx.beginPath(); ctx.moveTo(0,r*this.gridSize); ctx.lineTo(this.canvas.width,r*this.gridSize); ctx.stroke(); }
			// snake with head/body/tail
			if(this.snake.length){
				// head
				const head=this.snake[0];
				const headDir={dx:this.dx, dy:this.dy};
				this.drawHead(head, headDir);
				// body
				for(let i=1;i<this.snake.length-1;i++){ this.drawBody(this.snake[i], i); }
				// tail
				if(this.snake.length>1){ const tail=this.snake[this.snake.length-1]; const prev=this.snake[this.snake.length-2]; this.drawTail(tail, prev); }
			}
			// stones
			if(this.stones.length){ ctx.fillStyle=stoneColor; this.stones.forEach(s=>{ ctx.fillRect(s.x*this.gridSize+2, s.y*this.gridSize+2, this.gridSize-4, this.gridSize-4); }); }
			// apple food (body + stem + leaf)
			if(this.food){ const cx=this.food.x*this.gridSize+this.gridSize/2; const cy=this.food.y*this.gridSize+this.gridSize/2; const rad=this.gridSize/2-2; ctx.fillStyle='#ff3b30'; ctx.beginPath(); ctx.arc(cx,cy,rad,0,Math.PI*2); ctx.fill(); ctx.fillStyle='rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(cx-4,cy-4,2,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='#7b3f00'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(cx,cy-rad+4); ctx.lineTo(cx,cy-rad+10); ctx.stroke(); ctx.fillStyle='#2ecc71'; ctx.beginPath(); ctx.ellipse(cx+5, cy-rad+8, 5, 3, -0.6, 0, Math.PI*2); ctx.fill(); }
		}

		loop(ts=0){ if(ts-this.lastTick>=this.speedMs){ this.update(); this.draw(); this.lastTick=ts; } this.raf=requestAnimationFrame((t)=>this.loop(t)); }
		start(){ this.gameRunning=true; this.dx=1; this.dy=0; this.maybeSpawnStones(); this.loop(); }
		loseLife(){ this.lives--; this.updateLivesUI(); if(this.lives<=0){ return this.endGame(); } this.snake=[{x:Math.floor(this.cols/2),y:Math.floor(this.rows/2)}]; this.dx=1; this.dy=0; this.placeFood(); this.powerUpActive=false; document.getElementById('powerUpIndicator').style.display='none'; }
		endGame(){ this.gameRunning=false; cancelAnimationFrame(this.raf); document.getElementById('finalScore').textContent=String(this.score); document.getElementById('finalLevel').textContent=String(this.level); document.getElementById('gameOverScreen').style.display='block'; }
		updateUI(){ document.getElementById('score').textContent=String(this.score); document.getElementById('level').textContent=String(this.level); if(this.score>this.highScore){ this.highScore=this.score; localStorage.setItem('snakeHighScore',String(this.highScore)); } document.getElementById('highScore').textContent=String(this.highScore); document.getElementById('speedIndicator').textContent='Speed: '+(this.powerUpActive?'Boosted':(this.level>5?'Very Fast':this.level>3?'Fast':this.level>1?'Medium':'Normal')); this.updateLivesUI(); }
		updateLivesUI(){ const els=document.querySelectorAll('.life-heart'); els.forEach((el,i)=>{ if(i<this.lives) el.classList.remove('lost'); else el.classList.add('lost'); }); }
	}

	let game;
	function getDifficulty(){ const el=document.querySelector('input[name="difficulty"]:checked'); return el?el.value:'easy'; }
	window.startGame=function(){ document.getElementById('startScreen').style.display='none'; if(!game) game=new SnakeGame(); game.difficulty=getDifficulty(); game.resetState(); game.start(); };
	window.restartGame=function(){ document.getElementById('gameOverScreen').style.display='none'; game.resetState(); game.start(); };
	window.showStartScreen=function(){ document.getElementById('gameOverScreen').style.display='none'; document.getElementById('startScreen').style.display='block'; cancelAnimationFrame(game?.raf); game=new SnakeGame(); };
	window.resumeGame=function(){ document.getElementById('pauseScreen').style.display='none'; game.gamePaused=false; };

	window.addEventListener('load',()=>{ game=new SnakeGame(); document.getElementById('startScreen').style.display='block'; });
})();
