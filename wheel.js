// SVG 珐琅转盘；只呈现服务端选餐快照，不执行随机抽取或数据保存。
class MealWheel {
  constructor(svg, key, legend) {
    Object.assign(this, { svg, key, legend });
    this.disc = svg.querySelector('#wheel-disc');
    this.menus = [];
    this.angle = 0;
    this.active = -1;
    this.paths = null;
  }

  modulo(angle) { return ((angle % 360) + 360) % 360; }

  targetAngle(index) {
    return this.modulo(-(index + 0.5) * 360 / this.menus.length);
  }

  sectorAt(angle) {
    return Math.floor(this.modulo(-angle) / (360 / this.menus.length)) % this.menus.length;
  }

  element(tag, attributes) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  }

  baseColor(index) { return index % 2 ? '#e6e8dc' : '#f6f0e4'; }

  setMenus(menus, selectedMenu = null) {
    const unchanged = menus.length === this.menus.length && menus.every((menu, i) => menu === this.menus[i]);
    this.menus = menus.slice();
    const index = this.menus.indexOf(selectedMenu);
    if (!unchanged) this.angle = index < 0 ? 0 : this.targetAngle(index);
    this.disc.setAttribute('transform', `rotate(${this.angle} 260 266)`);
    try {
      if (!unchanged || this.paths === null) this.draw(index);
      else this.highlight(index);
    } catch (error) {
      this.paths = null; // 绘制失败后，下次必须重新构建，不能复用半成品。
      throw error;
    }
  }

  draw(selectedIndex = -1) {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) throw new Error('浏览器无法测量转盘文字');
    ctx.font = '19px "Microsoft YaHei", sans-serif';
    const count = this.menus.length;
    const available = count === 1 ? 280 : 2 * 139 * Math.sin(Math.PI / count) - 14;
    const nameFits = this.menus.every(name => ctx.measureText(name).width <= Math.min(150, available));
    const numberFits = ctx.measureText(String(count)).width <= available;
    this.mode = !count ? 'empty' : nameFits ? 'names' : numberFits ? 'numbers' : 'dense';
    this.disc.replaceChildren();
    this.paths = [];
    this.active = -1;
    const step = Math.PI * 2 / count;
    for (let i = 0; i < count; i++) {
      const start = -Math.PI / 2 + i * step, end = start + step;
      const d = count === 1
        ? 'M260 62 A204 204 0 1 1 260 470 A204 204 0 1 1 260 62 Z'
        : `M260 266 L${260 + 204 * Math.cos(start)} ${266 + 204 * Math.sin(start)} A204 204 0 ${step > Math.PI ? 1 : 0} 1 ${260 + 204 * Math.cos(end)} ${266 + 204 * Math.sin(end)} Z`;
      const path = this.element('path', { d, fill: this.baseColor(i), stroke: '#b6ad98', 'stroke-width': 1.2 });
      this.paths.push(path);
      this.disc.append(path);
    }
    this.outline = this.element('path', { fill: 'none', stroke: '#95653e', 'stroke-width': 2.5, display: 'none' });
    this.disc.append(this.outline);
    for (let i = 0; i < count && this.mode !== 'dense'; i++) {
      const mid = -Math.PI / 2 + (i + 0.5) * step;
      const x = 260 + 139 * Math.cos(mid), y = 266 + 139 * Math.sin(mid);
      const text = this.element('text', {
        x, y, transform: `rotate(${mid * 180 / Math.PI + 90} ${x} ${y})`,
        'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 19,
        fill: '#3d3a2f', 'font-family': 'Microsoft YaHei, sans-serif'
      });
      // 字的位置和方向只由所属扇区决定，不能随屏幕上下位置翻转。
      text.textContent = this.mode === 'names' ? this.menus[i] : String(i + 1);
      this.disc.append(text);
    }
    if (!count) {
      const text = this.element('text', { x: 260, y: 190, 'text-anchor': 'middle', 'font-size': 19, fill: '#3d3a2f' });
      text.textContent = '先添加一道菜';
      this.disc.append(text);
    }
    this.legend.replaceChildren(...this.menus.map(name => {
      const item = document.createElement('li');
      item.textContent = name;
      return item;
    }));
    this.key.hidden = this.mode === 'names' || this.mode === 'empty';
    this.highlight(selectedIndex);
  }

  highlight(index) {
    if (index === this.active) return;
    if (this.active >= 0) this.paths[this.active].setAttribute('fill', this.baseColor(this.active));
    this.active = index;
    if (index >= 0) {
      this.paths[index].setAttribute('fill', '#ecc298');
      this.outline.setAttribute('d', this.paths[index].getAttribute('d'));
      this.outline.removeAttribute('display');
    } else this.outline.setAttribute('display', 'none');
  }

  easing(progress) {
    const bezier = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
    let lo = 0, hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (bezier(mid, 0.42, 0.3) < progress) lo = mid;
      else hi = mid;
    }
    return bezier((lo + hi) / 2, 0, 1);
  }

  paintAngle(angle) {
    // 同一帧更新位置和高亮，避免独立计时器或合成动画导致二者错位。
    this.angle = angle;
    this.disc.setAttribute('transform', `rotate(${angle} 260 266)`);
    this.highlight(this.sectorAt(angle));
  }

  spin(index, onBoundary = () => {}) {
    if (!Number.isInteger(index) || index < 0 || index >= this.menus.length) {
      return Promise.reject(new Error('选中项不在候选列表中'));
    }
    const start = this.angle;
    const destination = start + 720 + this.modulo(this.targetAngle(index) - this.modulo(start));
    const duration = this.menus.length === 1 ? 1000 : 3000;
    return new Promise((resolve, reject) => {
      let frame, timer, started = null, finished = false, lastBoundary = null;
      const stop = error => {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(frame);
        clearTimeout(timer);
        if (error) {
          try { this.highlight(-1); } catch (_) {}
          reject(error);
        } else resolve();
      };
      timer = setTimeout(() => stop(new Error('转盘未按时完成，请重试。')), duration + 2000);
      const tick = now => {
        try {
          if (started === null) started = now;
          const progress = Math.min(1, (now - started) / duration);
          this.paintAngle(progress === 1 ? destination : start + (destination - start) * this.easing(progress));
          const boundary = Math.floor(this.angle / (360 / this.menus.length));
          if (progress < 1 && lastBoundary !== null && boundary !== lastBoundary) {
            // 声音回调只能观察实际帧；异常不得改变动画或服务端抽取结果。
            try { onBoundary(now); } catch (_) {}
          }
          lastBoundary = boundary;
          if (progress === 1) {
            if (this.active !== index) throw new Error('转盘位置异常，请重试。');
            stop();
          } else frame = requestAnimationFrame(tick);
        } catch (error) { stop(error); }
      };
      frame = requestAnimationFrame(tick);
    });
  }
}
window.MealWheel = MealWheel;
