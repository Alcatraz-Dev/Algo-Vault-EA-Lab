function oklchToHex(L,C,h){
  const hr=h*Math.PI/180;
  const a=C*Math.cos(hr), b=C*Math.sin(hr);
  const l_=L+0.3963377774*a+0.2158037573*b;
  const m_=L-0.1055613458*a-0.0638541728*b;
  const s_=L-0.0894841775*a-1.2914855480*b;
  const l=l_**3,m=m_**3,s=s_**3;
  let r= 4.0767416621*l -3.3077115913*m +0.2309699292*s;
  let g=-1.2684380046*l +2.6097574011*m -0.3413193965*s;
  let bl=-0.0041960863*l -0.7034186147*m +1.7076147010*s;
  const f=(x)=>{x=x<=0.0031308?12.92*x:1.055*Math.pow(x,1/2.4)-0.055;return Math.max(0,Math.min(1,x));};
  const to=(x)=>Math.round(f(x)*255);
  return "#"+[to(r),to(g),to(bl)].map(v=>v.toString(16).padStart(2,"0")).join("");
}
function hexToRgb(hex){hex=hex.replace("#","");return [0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255);}
function lum(hex){const [r,g,b]=hexToRgb(hex).map(c=>c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4));return 0.2126*r+0.7152*g+0.0722*b;}
function contrast(a,b){const l1=lum(a),l2=lum(b);const [hi,lo]=l1>l2?[l1,l2]:[l2,l1];return (hi+0.05)/(lo+0.05);}
const c=(L,C,h)=>oklchToHex(L,C,h);
const probes = {
  darkBg: c(0.155,0.005,255),
  darkCard: c(0.185,0.006,255),
  darkPopover: c(0.205,0.006,255),
  darkMuted: c(0.235,0.007,255),
  darkBorder: c(0.30,0.008,255),
  darkInput: c(0.34,0.008,255),
  darkFg: c(0.97,0.002,255),
  darkMutedFg: c(0.70,0.012,255),
  gold: c(0.80,0.105,88),
  goldDeep: c(0.62,0.11,80),
  goldTextLight: c(0.50,0.10,72),
  goldFgInk: c(0.20,0.03,80),
  posDark: c(0.78,0.16,162),
  negDark: c(0.70,0.19,25),
  warnDark: c(0.80,0.14,75),
  infoDark: c(0.72,0.14,240),
  posLight: c(0.50,0.13,162),
  negLight: c(0.50,0.20,27),
  warnLight: c(0.52,0.13,65),
  infoLight: c(0.50,0.15,250),
  lightBg: c(0.985,0.002,255),
  lightCard: c(1,0,0),
  lightFg: c(0.24,0.01,255),
  lightMuted: c(0.955,0.003,255),
  lightMutedFg: c(0.50,0.012,255),
  lightBorder: c(0.90,0.006,255),
};
for(const [k,v] of Object.entries(probes)) console.log(k.padEnd(14), v);
console.log("\n--- contrast checks ---");
const D=probes.darkBg;
const row=(label,a,b)=>console.log(label.padEnd(34), a, "on", b, "=", contrast(a,b).toFixed(2));
row("gold on darkBg",probes.gold,D);
row("gold on darkCard",probes.gold,probes.darkCard);
row("goldInk on gold",probes.goldFgInk,probes.gold);
row("darkFg on darkBg",probes.darkFg,D);
row("darkMutedFg on darkBg",probes.darkMutedFg,D);
row("darkMutedFg on darkCard",probes.darkMutedFg,probes.darkCard);
row("posDark on darkBg",probes.posDark,D);
row("posDark on darkCard",probes.posDark,probes.darkCard);
row("negDark on darkBg",probes.negDark,D);
row("warnDark on darkBg",probes.warnDark,D);
row("infoDark on darkBg",probes.infoDark,D);
const Lb=probes.lightBg,Lc=probes.lightCard;
row("goldTextLight on lightBg",probes.goldTextLight,Lb);
row("goldTextLight on lightCard",probes.goldTextLight,Lc);
row("goldDeep on lightBg",probes.goldDeep,Lb);
row("lightFg on lightBg",probes.lightFg,Lb);
row("lightMutedFg on lightBg",probes.lightMutedFg,Lb);
row("posLight on lightBg",probes.posLight,Lb);
row("negLight on lightBg",probes.negLight,Lb);
row("warnLight on lightBg",probes.warnLight,Lb);
row("infoLight on lightBg",probes.infoLight,Lb);
