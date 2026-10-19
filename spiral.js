// Buse'ye özel sarmal çizimleri (altın oran ve Arşimet sarmalları), iki sayfa da kullanır.
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const GOLDEN_K = Math.log((1 + Math.sqrt(5)) / 2) / (Math.PI / 2); // her çeyrek turda φ kat büyür

  // r = a·e^(kθ), merkezden rMax'a kadar
  function goldenPath(cx, cy, rMax, rMin = 0.6, steps = 700) {
    const t1 = Math.log(rMax / rMin) / GOLDEN_K;
    let d = '';
    for (let i = 0; i <= steps; i++) {
      const t = (t1 * i) / steps, r = rMin * Math.exp(GOLDEN_K * t);
      d += (i ? 'L' : 'M') + (cx + r * Math.cos(t)).toFixed(2) + ' ' + (cy + r * Math.sin(t)).toFixed(2);
    }
    return d;
  }

  // r = rMax·θ/θmax, eşit aralıklı halkalar
  function archPath(cx, cy, rMax, turns = 3, steps = 360) {
    const t1 = turns * 2 * Math.PI;
    let d = '';
    for (let i = 0; i <= steps; i++) {
      const t = (t1 * i) / steps, r = (rMax * t) / t1;
      d += (i ? 'L' : 'M') + (cx + r * Math.cos(t)).toFixed(2) + ' ' + (cy + r * Math.sin(t)).toFixed(2);
    }
    return d;
  }

  // Fibonacci kareleri ve içlerinden geçen çeyrek yaylar (klasik altın sarmal çizimi)
  function fibParts(n = 10) {
    const F = [1, 1];
    while (F.length < n) F.push(F.at(-1) + F.at(-2));
    let minx = 0, miny = 0, maxx = 1, maxy = 1;
    const squares = [[0, 0, 1]];
    let d = 'M0 0 A1 1 0 0 0 1 1';
    for (let i = 1; i < n; i++) {
      const s = F[i], side = (i - 1) % 4;
      let x0, y0, ex, ey;
      if (side === 0) { x0 = maxx; y0 = miny; ex = x0 + s; ey = y0; maxx += s; }
      else if (side === 1) { x0 = minx; y0 = miny - s; ex = x0; ey = y0; miny -= s; }
      else if (side === 2) { x0 = minx - s; y0 = miny; ex = x0; ey = y0 + s; minx -= s; }
      else { x0 = minx; y0 = maxy; ex = x0 + s; ey = y0 + s; maxy += s; }
      squares.push([x0, y0, s]);
      d += ` A${s} ${s} 0 0 0 ${ex} ${ey}`;
    }
    return { squares, d, box: [minx, miny, maxx - minx, maxy - miny] };
  }

  function fib(size, className = '') {
    const { squares, d, box } = fibParts();
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', box.join(' '));
    svg.setAttribute('width', size); svg.setAttribute('height', (size * box[3]) / box[2]);
    svg.setAttribute('aria-hidden', 'true');
    if (className) svg.setAttribute('class', className);
    const id = 'sg' + ++gradId, w = box[2] / 400;
    svg.innerHTML = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" style="stop-color:var(--accent)"/><stop offset="1" style="stop-color:var(--accent-2)"/></linearGradient></defs>`
      + squares.map(([x, y, s]) => `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="none" stroke="url(#${id})" stroke-width="${w * 0.6}" opacity=".55"/>`).join('')
      + `<path d="${d}" fill="none" stroke="url(#${id})" stroke-width="${w * 2.2}" stroke-linecap="round"/>`;
    return svg;
  }

  let gradId = 0;
  function make(kind, size, { stroke = 'url', width = 2, className = '', turns = 3 } = {}) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('width', size); svg.setAttribute('height', size);
    svg.setAttribute('aria-hidden', 'true');
    if (className) svg.setAttribute('class', className);
    let color = stroke;
    if (stroke === 'url') {
      const id = 'sg' + ++gradId;
      svg.innerHTML = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" style="stop-color:var(--accent)"/><stop offset="1" style="stop-color:var(--accent-2)"/></linearGradient></defs>`;
      color = `url(#${id})`;
    }
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', kind === 'golden' ? goldenPath(50, 50, 46) : archPath(50, 50, 44, turns));
    p.setAttribute('fill', 'none'); p.setAttribute('stroke', color);
    p.setAttribute('stroke-width', width); p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('pathLength', '1');
    svg.append(p);
    return svg;
  }

  window.Spiral = { make, fib, goldenPath, archPath };

  // sayfadaki <span data-spiral="golden|arch" data-size=".." ...> yer tutucularını doldur
  for (const el of document.querySelectorAll('[data-spiral]')) {
    if (el.dataset.spiral === 'fib') { el.replaceWith(fib(el.dataset.size || 600, el.className)); continue; }
    el.replaceWith(make(el.dataset.spiral, el.dataset.size || 24, {
      stroke: el.dataset.stroke || 'url', width: +(el.dataset.width || 2),
      className: el.className, turns: +(el.dataset.turns || 3),
    }));
  }
})();
