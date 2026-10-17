export const N = 180, K = 14;
export const NAMES = ['generative art history','ai agents and orchestration','complex systems science','interactive design and 3d tools','emergent geometry','human cognition and ai','digital information systems','visual encoding and perception','creative coding and animation','knowledge graphs and agents','symmetry in biological structures','computational design and art','software tools and workflows','pattern and structure'];
export function rng(seed){let s=seed>>>0;return()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
// per-state params: [spoke, hub, cross, curvature]
export const STATE_PARAMS = [[.7,.9,.35,.1],[.55,.8,.2,.16],[.5,.7,.15,.2],[.45,.9,.1,.3],[.4,.8,0,.24]];
export const TAGS = ['DENSITY / MAPPER','DISTRIBUTED / CLUSTERS','PCA / AXES','CENTROID / FORCE','SPARSE / OUTLIERS'];
export const CAPTIONS = ['1. density: where attention keeps gravitating','','2. pca: the dominant axes of variation','3. centroid: typical vs. outlier',''];

export function build(){
  const r = rng(20261017);
  const cluster = new Uint8Array(N), size = new Float32Array(N), imp = new Float32Array(N), isOut = new Uint8Array(N);
  const tint = new Float32Array(N*3), labels = new Array(N).fill(null), ld = new Float32Array(N*3), od = new Float32Array(N*3);
  const w = Array.from({length:K},(_,k)=>k===0?3.4:0.6+r()*1.1), tot = w.reduce((a,b)=>a+b,0);
  const counts = new Array(K).fill(0);
  for(let n=0;n<N;n++){
    if(n<K) cluster[n]=n; else { let x=r()*tot,k=0; while(x>w[k]&&k<K-1){x-=w[k];k++} cluster[n]=k; }
    counts[cluster[n]]++;
    const hub=n<K;
    imp[n]=hub?1:Math.pow(r(),2.2);
    size[n]=hub?1.0:0.55+imp[n]*0.55+r()*0.08;
    isOut[n]=(!hub&&r()<0.07)?1:0;
    const p=r(); const c=p<0.04?[.78,.95,.2]:p<0.07?[.5,.9,.7]:p<0.2?[.7,.7,.68]:[1,1,.98];
    tint.set(c,n*3);
    if(hub) labels[n]=NAMES[n];
    let v; do{v=[r()*2-1,r()*2-1,r()*2-1]}while(v[0]**2+v[1]**2+v[2]**2>1);
    ld.set(hub?[0,0,0]:v,n*3);
    let u; do{u=[r()*2-1,r()*2-1,r()*2-1]}while(u[0]**2+u[1]**2+u[2]**2>1||u[0]**2+u[1]**2+u[2]**2<0.05);
    const l=Math.hypot(...u); od.set([u[0]/l,u[1]/l,u[2]/l],n*3);
  }
  const cs = counts.map(c=>0.7*Math.cbrt(c));
  const layouts = [0,1,2,3,4].map(type=>{
    const rr=rng(1000+type*77), P=new Float32Array(N*3), C=[];
    for(let k=0;k<K;k++){
      let c;
      if(type===0){ const a=k*2.39996,rad=Math.sqrt((k+.5)/K);c=[Math.cos(a)*rad*10.5,Math.sin(a)*rad*7.5,(rr()-.5)*5] }
      else if(type===1){ const y=1-2*(k+.5)/K,rad=Math.sqrt(1-y*y),a=k*2.39996+1;c=[Math.cos(a)*rad*10,y*6.5,Math.sin(a)*rad*7] }
      else if(type===2){ const x=-12.5+25*k/(K-1),a=-0.17;const y=(rr()-.5)*2.2,z=(rr()-.5)*4;c=[x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a),z] }
      else if(type===3){ if(k===0)c=[0,0,0]; else {const a=Math.PI*2*(k-1)/(K-1)+.3;c=[Math.cos(a)*11.5,Math.sin(a)*6.5,Math.sin(a)*3.5+(rr()-.5)*2]} }
      else { c=[(rr()-.5)*26,(rr()-.5)*15,(rr()-.5)*12] }
      C.push(c);
    }
    const sc=[[.9,.9,.9],[.8,.8,.8],[1.15,.42,.7],[.7,.7,.6],[.5,.5,.5]][type];
    const s0=type===3?2.1:1;
    for(let n=0;n<N;n++){
      const k=cluster[n],c=C[k],s=cs[k]*(k===0?s0:1);
      let x=c[0]+ld[n*3]*s*sc[0]*1.1,y=c[1]+ld[n*3+1]*s*sc[1]*1.1,z=c[2]+ld[n*3+2]*s*sc[2]*1.1;
      if(isOut[n]&&(type===3||type===4)){const R=type===3?1:0.8,d=(10+(n%7))*R;x=od[n*3]*d*1.15;y=od[n*3+1]*d*.65;z=od[n*3+2]*d*.7}
      P[n*3]=x;P[n*3+1]=y;P[n*3+2]=z;
    }
    return P;
  });
  const E=[], add=(a,b,c,wt)=>E.push([a,b,c,wt,(r()<.5?-1:1)*(0.6+r()*0.6)]);
  for(let n=K;n<N;n++){ add(n,cluster[n],0,0.5+0.5*imp[n]);
    if(r()<0.35){let m,t=0;do{m=K+(r()*(N-K)|0);t++}while((m===n||cluster[m]!==cluster[n])&&t<80);if(t<80)add(n,m,0,0.45)} }
  for(let k=0;k<K;k++){ add(k,(k+1)%K,1,1); const o=(k+2+(r()*(K-3)|0))%K; if(o!==k)add(k,o,1,.8); if(k>0)add(k,0,1,.9); }
  for(let i=0;i<30;i++){const a=K+(r()*(N-K)|0),b=K+(r()*(N-K)|0);if(cluster[a]!==cluster[b])add(a,b,2,.5)}
  return {cluster,size,imp,isOut,tint,labels,layouts,edges:E};
}

