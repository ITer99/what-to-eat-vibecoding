'use strict';
// 浏览器原生音效；只播放已确认的 C 完成铃，不参与选餐或菜单保存。
class MealSounds {
  constructor(context=null) {
    this.context=context;this.master=null;this.voices=new Set();this.enabled=false;
    this.lastTick=-Infinity;this.lastClick=-Infinity;this.onUnavailable=()=>{};
    try{this.enabled=document.cookie.split(';').some(item=>item.trim()==='what_to_eat_sound=on');}catch(_){}
    if(context){this.enabled=true;this.createMaster();}
  }
  createMaster(){if(this.master)return;this.master=this.context.createGain();this.master.gain.value=.32;this.master.connect(this.context.destination);this.sampleBuffers={};
    for(const [variant,sample] of Object.entries(window.MEAL_SOUND_DATA||{})){
      const raw=atob(sample.pcm),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),view=new DataView(bytes.buffer),buffer=this.context.createBuffer(1,bytes.length/2,sample.rate),data=buffer.getChannelData(0);
      for(let i=0;i<data.length;i++)data[i]=view.getInt16(i*2,true)/32768/.32;
      this.sampleBuffers[variant]=buffer;
    }
  }
  setEnabled(value){this.enabled=Boolean(value);try{document.cookie=`what_to_eat_sound=${value?'on':'off'}; Max-Age=31536000; Path=/; SameSite=Lax`;}catch(_){}if(!this.enabled)this.stopAll();}
  unlock(){
    if(!this.enabled)return;
    try{
      if(!this.context){const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw Error('unavailable');this.context=new Audio();this.createMaster();}
      if(this.context.state==='suspended')this.context.resume().catch(()=>this.onUnavailable());
    }catch(_){this.onUnavailable();}
  }
  beginSpin(){this.lastTick=-Infinity;}
  tick(now){
    if(now-this.lastTick<125 || now-this.lastClick<75)return;
    if(this.play('tick'))this.lastTick=now;
  }
  // 没有声音队列。每次只根据当前实际帧决定是否发出一个短音。
  play(kind,at=null){
    if(!this.enabled||document.hidden)return false;
    try{
      const ctx=this.context;if(!ctx||!this.master||ctx.state==='closed'||(at===null&&ctx.state!=='running'))return false;
      const t=at===null?ctx.currentTime:at;
      if(kind==='click'){this.lastClick=performance.now();this.stopVoices('done');}
      if(kind==='done')this.stopTicks();
      if(kind==='done'){
        const buffer=this.sampleBuffers.C;if(!buffer)throw Error('sample unavailable');
        const source=ctx.createBufferSource(),envelope=ctx.createGain();source.buffer=buffer;envelope.gain.value=1;source.connect(envelope);envelope.connect(this.master);this.track(source,envelope,kind,[],t,buffer.duration);
      }else{
        // 极短的敲击噪声负责清脆的起音，低频短音保留实体按钮的触感。
        const button=kind!=='tick',level=kind==='saved'?.55:1;
        this.tap(kind,t,button?.022:.016,(button?.13:.080)*level,button?850:1400,button?4100:4700);
        this.tone(kind,button?260:1150,t,button?.026:.018,(button?.055:.028)*level,'sine',.65,.0008);
      }
      return true;
    }catch(_){this.stopAll();this.onUnavailable();return false;}
  }
  tone(kind,hz,start,duration,gain,type='sine',drop=1,attack=.001){
    const ctx=this.context,oscillator=ctx.createOscillator(),envelope=ctx.createGain();
    oscillator.type=type;oscillator.frequency.setValueAtTime(hz,start);
    if(drop!==1)oscillator.frequency.exponentialRampToValueAtTime(hz*drop,start+duration);
    envelope.gain.setValueAtTime(0,start);envelope.gain.linearRampToValueAtTime(gain,start+attack);
    envelope.gain.exponentialRampToValueAtTime(.00007,start+duration-.002);envelope.gain.linearRampToValueAtTime(0,start+duration);
    oscillator.connect(envelope);envelope.connect(this.master);this.track(oscillator,envelope,kind,[],start,duration);
  }
  tap(kind,start,duration,gain,low,high){
    const ctx=this.context,buffer=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*duration),ctx.sampleRate),data=buffer.getChannelData(0);
    let seed=9137;for(let i=0;i<data.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;data[i]=(seed>>>0)/2147483648-1;}
    const source=ctx.createBufferSource(),hp=ctx.createBiquadFilter(),lp=ctx.createBiquadFilter(),envelope=ctx.createGain();source.buffer=buffer;
    hp.type='highpass';hp.frequency.value=low;hp.Q.value=.6;lp.type='lowpass';lp.frequency.value=high;lp.Q.value=.6;
    envelope.gain.setValueAtTime(0,start);envelope.gain.linearRampToValueAtTime(gain,start+.0007);
    envelope.gain.exponentialRampToValueAtTime(.00007,start+duration-.002);envelope.gain.linearRampToValueAtTime(0,start+duration);
    source.connect(hp);hp.connect(lp);lp.connect(envelope);envelope.connect(this.master);this.track(source,envelope,kind,[hp,lp],start,duration);
  }
  track(oscillator,envelope,kind,filters,start,duration){
    const voice={oscillator,envelope,kind,filters};this.voices.add(voice);
    oscillator.onended=()=>{oscillator.disconnect();envelope.disconnect();for(const filter of filters)filter.disconnect();this.voices.delete(voice);};
    oscillator.start(start);oscillator.stop(start+duration);
  }
  stopTicks(){this.stopVoices('tick');}
  stopVoices(kind=null){
    for(const voice of [...this.voices]){if(kind&&voice.kind!==kind)continue;try{voice.envelope.disconnect();voice.oscillator.stop();voice.oscillator.disconnect();for(const filter of voice.filters)filter.disconnect();}catch(_){}this.voices.delete(voice);}
  }
  stopAll(){this.stopVoices();}
}

window.MealSounds=MealSounds;
