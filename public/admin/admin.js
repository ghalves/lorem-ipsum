/* Painel do lojista: SPA sem dependências. */
(function () {
  'use strict';

  // ---------- sessão ----------
  var m = location.hash.match(/session=([^&]+)/);
  if (m) {
    try { sessionStorage.setItem('szp_session', m[1]); } catch (e) { /* noop */ }
    history.replaceState(null, '', location.pathname);
  }
  var TOKEN = m ? m[1] : (function () { try { return sessionStorage.getItem('szp_session'); } catch (e) { return null; } })();

  var view = document.getElementById('view');
  var state = { me: null };

  // ---------- helpers ----------
  function h(tag, attrs) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function api(method, path, body) {
    return fetch('/api/admin' + path, {
      method: method,
      headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().then(function (j) {
        if (r.status === 401) { showExpired(); throw new Error(j.error); }
        if (!r.ok) throw new Error(j.error || 'Erro');
        return j;
      });
    });
  }
  var toastTimer;
  function toast(msg, isErr) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 3200);
  }
  function fail(e) { toast(e.message || 'Erro', true); }
  // cabeçalho de página do design system: título leve à esquerda, ferramentas à direita
  function pageHead(title, sub, tools) {
    return h('div', { class: 'page-head' },
      h('div', { class: 'tt' }, h('h1', { text: title }), sub ? h('p', { class: 'sub', text: sub }) : null),
      tools ? h('div', { class: 'tools' }, tools) : null);
  }
  // Ícones: Hugeicons Free (Stroke Rounded), carregados de icons.js.
  var ICON = window.VIBE_ICONS || {};
  function icon(name) {
    var sp = document.createElement('span');
    sp.innerHTML = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + (ICON[name] || '') + '</svg>';
    return sp.firstChild;
  }
  var NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    var el = document.createElementNS(NS, tag);
    for (var k in attrs || {}) el.setAttribute(k, attrs[k]);
    return el;
  }
  function nf(n) { return Number(n || 0).toLocaleString('pt-BR'); }

  // ---- números com micro-gráfico (padrão "rótulo · numeral leve · variação") ----
  // Sparkline: área suave + linha de 2px, sem eixos nem rótulos, só a forma.
  function sparkline(values, color) {
    var W = 96, H = 34, n = values.length;
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'presentation' });
    if (n < 2) return svg;
    var max = Math.max.apply(null, values.concat([1]));
    var x = function (i) { return (i / (n - 1)) * W; };
    var y = function (v) { return H - 3 - (v / max) * (H - 7); };
    var d = values.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join(' ');
    svg.appendChild(svgEl('path', { d: d + ' L' + W + ' ' + H + ' L0 ' + H + ' Z', fill: color, 'fill-opacity': '.12', stroke: 'none' }));
    svg.appendChild(svgEl('path', { d: d, fill: 'none', stroke: color, 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    return svg;
  }
  function kpi(o) {
    var box = h('div', { class: 'kpi' },
      h('div', { class: 'k-lab' }, o.label, o.help ? h('span', { class: 'k-help', title: o.help, text: '?' }) : null),
      h('div', { class: 'k-val', text: o.value }));
    if (o.delta) {
      var d = h('div', { class: 'k-delta' + (o.up === true ? ' up' : o.up === false ? ' down' : '') });
      if (o.up != null) d.appendChild(icon(o.up ? 'arrowUp' : 'arrowDown'));
      d.appendChild(document.createTextNode(o.delta));
      box.appendChild(d);
    }
    if (o.note) box.appendChild(h('div', { class: 'k-note', text: o.note }));
    if (o.series && o.series.length > 1) {
      var sp = h('div', { class: 'k-spark' });
      sp.appendChild(sparkline(o.series, o.color || 'var(--data-1)'));
      box.appendChild(sp);
    }
    return box;
  }
  function kpiRow(items) { return h('div', { class: 'kpi-row' }, items.map(kpi)); }

  // ---- gráfico de linhas (duas séries, um único eixo) ----
  // Eixo único de propósito: as duas séries são contagens comparáveis, então
  // dois eixos distorceriam a leitura. Identidade vem da legenda + cor.
  function lineChart(rows, series, fmtX) {
    if (!rows.length) return h('p', { class: 'chart-empty', text: 'Sem dados no período.' });
    var W = 960, H = 250, padL = 44, padR = 16, padT = 14, padB = 30;
    var max = 1;
    rows.forEach(function (r) { series.forEach(function (se) { max = Math.max(max, Number(r[se.key]) || 0); }); });
    var ticks = 4, step = Math.max(1, Math.ceil(max / ticks));
    var top = step * ticks;
    var x = function (i) { return padL + (rows.length === 1 ? (W - padL - padR) / 2 : (i / (rows.length - 1)) * (W - padL - padR)); };
    var y = function (v) { return padT + (1 - v / top) * (H - padT - padB); };

    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Uso do provador no período' });
    for (var t = 0; t <= ticks; t++) {
      var vy = y(step * t);
      svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: vy, y2: vy, class: 'g-line' }));
      var lab = svgEl('text', { x: padL - 10, y: vy + 4, class: 'g-txt', 'text-anchor': 'end' });
      lab.textContent = nf(step * t);
      svg.appendChild(lab);
    }
    series.forEach(function (se) {
      var d = rows.map(function (r, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(Number(r[se.key]) || 0).toFixed(1); }).join(' ');
      if (rows.length === 1) {
        svg.appendChild(svgEl('circle', { cx: x(0), cy: y(Number(rows[0][se.key]) || 0), r: 4, fill: se.color }));
      } else {
        svg.appendChild(svgEl('path', { d: d, fill: 'none', stroke: se.color, 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      }
    });
    var nX = Math.min(rows.length, 6);
    for (var k = 0; k < nX; k++) {
      var i = nX === 1 ? 0 : Math.round(k * (rows.length - 1) / (nX - 1));
      var tx = svgEl('text', { x: x(i), y: H - 8, class: 'g-txt', 'text-anchor': k === 0 ? 'start' : k === nX - 1 ? 'end' : 'middle' });
      tx.textContent = fmtX(rows[i]);
      svg.appendChild(tx);
    }
    // camada de leitura: linha-guia + balão com os valores do dia
    var guide = svgEl('line', { y1: padT, y2: H - padB, class: 'g-line', stroke: 'var(--muted)', opacity: '0' });
    svg.appendChild(guide);
    var dots = series.map(function (se) {
      var c = svgEl('circle', { r: 4.5, fill: se.color, stroke: '#fff', 'stroke-width': '2', opacity: '0' });
      svg.appendChild(c); return c;
    });
    var tip = h('div', { class: 'chart-tip', hidden: true });
    var wrap = h('div', { class: 'chart' });
    wrap.appendChild(svg);
    wrap.appendChild(tip);
    svg.addEventListener('mousemove', function (ev) {
      var b = svg.getBoundingClientRect();
      var px = (ev.clientX - b.left) / b.width * W;
      var i = Math.max(0, Math.min(rows.length - 1, Math.round((px - padL) / ((W - padL - padR) / Math.max(1, rows.length - 1)))));
      guide.setAttribute('x1', x(i)); guide.setAttribute('x2', x(i)); guide.setAttribute('opacity', '.35');
      dots.forEach(function (c, j) { c.setAttribute('cx', x(i)); c.setAttribute('cy', y(Number(rows[i][series[j].key]) || 0)); c.setAttribute('opacity', '1'); });
      tip.innerHTML = '';
      add(tip, [h('b', { text: fmtX(rows[i]) }), series.map(function (se) {
        return h('span', null, h('i', { style: 'background:' + se.color }), se.label + ': ' + nf(rows[i][se.key]));
      })]);
      tip.hidden = false;
      tip.style.left = Math.max(0, Math.min(b.width - 150, (x(i) / W) * b.width - 75)) + 'px';
    });
    svg.addEventListener('mouseleave', function () {
      guide.setAttribute('opacity', '0');
      dots.forEach(function (c) { c.setAttribute('opacity', '0'); });
      tip.hidden = true;
    });
    return h('div', null,
      h('div', { class: 'chart-legend' }, series.map(function (se) {
        return h('span', null, h('i', { style: 'background:' + se.color }), se.label);
      })), wrap);
  }

  // no celular, as ferramentas do topo viram só o ícone (o nome fica no title e no aria-label)
  function chipBtn(label, iconName, onclick) {
    return h('button', { class: 'chip-btn', type: 'button', onclick: onclick, title: label, 'aria-label': label },
      iconName ? icon(iconName) : null, h('span', { class: 'lbl', text: label }));
  }
  /** '1 prova' / '3 provas' */
  function pl(n, one, many) { return nf(n) + ' ' + (Number(n) === 1 ? one : many); }
  function pct(x) { return x == null ? 'sem dados' : Math.round(x * 100) + '%'; }
  function fmtDate(s) { if (!s) return 'nunca'; var d = new Date(s.replace(' ', 'T') + (s.indexOf('Z') < 0 && s.indexOf('+') < 0 ? 'Z' : '')); return d.toLocaleString('pt-BR'); }
  function showExpired() {
    // ambiente de teste (/dev ligado): entra de novo na loja demo em vez de travar
    if (!m) {
      fetch('/dev/ping').then(function (r) { if (r.ok) location.replace('/dev/login'); else paintExpired(); }).catch(paintExpired);
      return;
    }
    paintExpired();
  }
  function paintExpired() {
    view.innerHTML = '';
    add(view, h('div', { class: 'card empty' }, h('h2', { text: 'Sessão expirada' }),
      h('p', { text: 'Abra o app novamente pelo painel da sua loja Nuvemshop.' })));
  }

  // ---------- tabelas no celular ----------
  // Cada célula recebe o nome da coluna (data-label); no celular o CSS mostra
  // cada linha como um cartão, com o rótulo acima do valor.
  function stackTable(tbl) {
    var ths = Array.prototype.map.call(tbl.querySelectorAll('thead th'), function (th) { return th.textContent.trim(); });
    Array.prototype.forEach.call(tbl.querySelectorAll('tbody tr'), function (tr) {
      var main = false;
      Array.prototype.forEach.call(tr.children, function (td, i) {
        if (!ths[i]) return;
        if (!main) { td.classList.add('st-main'); main = true; return; }
        td.setAttribute('data-label', ths[i]);
      });
    });
    tbl.classList.add('stack');
  }
  new MutationObserver(function () {
    Array.prototype.forEach.call(view.querySelectorAll('table.t:not(.stack)'), stackTable);
  }).observe(view, { childList: true, subtree: true });

  // ---------- abas ----------
  var tabs = document.getElementById('tabs');
  tabs.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]');
    if (b) go(b.getAttribute('data-tab'));
  });
  function go(tab) {
    Array.prototype.forEach.call(tabs.children, function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === tab)); });
    view.innerHTML = '';
    ({ tryon: renderTryon, leads: renderLeads, prefs: renderPrefs, plan: renderPlan, products: renderProducts })[tab]();
  }

  // ---------- provador virtual ----------
  var MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  function brl(n, cents) { return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 }); }
  function fmtPhone(p) {
    var d = String(p || '').replace(/^\+55/, '');
    return d.length === 11 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7)
      : d.length === 10 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6) : p;
  }
  function renewText() { var now = new Date(); return '1º de ' + MONTHS[(now.getMonth() + 1) % 12]; }
  function downloadLeads() {
    fetch('/api/admin/tryon/leads.csv', { headers: { Authorization: 'Bearer ' + TOKEN } }).then(function (r) {
      if (!r.ok) throw new Error('Não deu para baixar agora');
      return r.blob();
    }).then(function (b) {
      var a = h('a', { href: URL.createObjectURL(b), download: 'leads-provador.csv' });
      document.body.appendChild(a); a.click(); a.remove();
    }).catch(fail);
  }
  // aviso curto da cota; a troca de plano fica na aba Planos
  function quotaBanner(q) {
    var usedPct = q.plan.quota ? Math.min(1, q.used / q.plan.quota) : 0;
    var title, text, cls = 'banner';
    if (q.plan.key === 'none') { title = 'Escolha um plano para o provador aparecer na loja'; text = 'Sem plano, o botão do provador fica escondido.'; }
    else if (q.exhausted) { title = 'As provas do mês acabaram'; text = 'O botão saiu da loja até ' + renewText() + '. Suba de plano para voltar agora.'; cls += ' bad'; }
    else if (q.alert) { title = 'Você já usou ' + pct(usedPct) + ' das provas do mês'; text = 'Quando acabar, o botão sai da loja até ' + renewText() + '.'; cls += ' warn'; }
    else return null;
    return h('div', { class: cls }, icon('alert'), h('div', { class: 'banner-t' }, h('b', { text: title }), h('span', { text: text })),
      h('button', { class: 'btn sm primary', type: 'button', onclick: function () { go('plan'); } }, 'Ver planos', icon('arrow-right')));
  }
  function barList(rows) {
    var max = Math.max.apply(null, rows.map(function (x) { return x.n; }).concat([1]));
    return h('div', { class: 'bars' }, rows.map(function (x) {
      return h('div', { class: 'bar' + (x.wide ? ' wide' : '') }, h('b', { text: x.label }),
        h('div', { class: 'track' }, h('i', { style: 'width:' + Math.max(x.n ? 3 : 0, x.n / max * 100) + '%' + (x.color ? ';background:' + x.color : '') })),
        h('span', { class: 'num' }, nf(x.n), x.rate != null ? h('small', { text: ' · ' + x.rate }) : null));
    }));
  }

  function renderTryon() {
    var PERIODS = [['today', 'Hoje'], ['yesterday', 'Ontem'], ['7', '7 dias'], ['30', '30 dias'], ['90', '90 dias']];
    var days = h('select', { class: 'chip-btn', 'aria-label': 'Período' },
      PERIODS.map(function (p) { return h('option', { value: p[0], text: p[1], selected: p[0] === '30' }); }));
    function periodText() { var o = days.options[days.selectedIndex]; return o.value === 'today' || o.value === 'yesterday' ? o.text.toLowerCase() : 'últimos ' + o.text; }
    var box = h('div');
    // hoje e ontem: série por hora; demais períodos: por dia
    function lbl(row) { return row.hour != null ? String(row.hour).padStart(2, '0') + 'h' : row.day.slice(8, 10) + '/' + row.day.slice(5, 7); }
    // acima de 100% a etapa anterior não registrou tudo (ex.: aberturas contadas só a partir da versão nova): sem porcentagem
    function rate(a, b) { return b && a <= b ? pct(a / b) : null; }
    function load() {
      api('GET', '/tryon?period=' + days.value).then(function (r) {
        var q = r.quota, s = r.stats, d = s.daily || [], pv = s.previous;
        var col = function (k) { return d.map(function (x) { return x[k] || 0; }); };
        var cmp = function (now, key, fmt) { return pv ? { delta: prevText(now, pv[key], fmt), up: upFlag(now, pv[key]) } : { delta: periodText() }; };
        // receita comparada ao plano: só em janelas de 30 dias ou mais (o plano é mensal)
        var planMult = q.plan.price && s.revenue && s.days >= 30 ? s.revenue / (q.plan.price * s.days / 30) : null;
        box.innerHTML = '';
        add(box, [
          quotaBanner(q),
          kpiRow([
            Object.assign({ label: 'Provas', help: 'Provas prontas no período. Erros não contam.', value: nf(s.tryons),
              note: q.plan.quota ? nf(q.used) + ' de ' + nf(q.plan.quota) + ' no mês' : null, series: col('tryons'), color: 'var(--data-2)' }, cmp(s.tryons, 'tryons')),
            Object.assign({ label: 'Pessoas que provaram', help: 'Compradores diferentes que viram pelo menos uma prova.', value: nf(s.people),
              note: s.people ? String(Math.round(s.tryons / s.people * 10) / 10).replace('.', ',') + ' provas por pessoa' : null, series: col('people'), color: 'var(--data-2)' }, cmp(s.people, 'people')),
            Object.assign({ label: 'Vendas com o provador', help: 'Pedidos pagos com um produto que o comprador provou antes, em qualquer tamanho.', value: nf(s.sales),
              note: s.people ? pct(s.sales / s.people) + ' de quem provou comprou' : null, series: col('sales'), color: 'var(--data-1)' }, cmp(s.sales, 'sales')),
            Object.assign({ label: 'Receita com o provador', help: 'Soma dos produtos provados nos pedidos pagos (preço x quantidade). Outros itens do pedido não entram.', value: brl(s.revenue),
              note: planMult ? String(Math.round(planMult * 10) / 10).replace('.', ',') + '× o valor do plano' : null, series: col('revenue'), color: 'var(--data-1)' }, cmp(s.revenue, 'revenue', brl)),
          ]),
          h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: 'Quem provou e quem comprou' })),
            s.tryons ? lineChart(d, [
              { key: 'people', label: 'Pessoas que provaram', color: 'var(--data-2)' },
              { key: 'sales', label: 'Vendas', color: 'var(--data-1)' },
            ], lbl) : h('p', { class: 'chart-empty', text: 'As provas aparecem aqui assim que os compradores começarem a usar.' })),
          h('div', { class: 'grid cols-2' },
            h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: 'Do botão à compra' })),
              barList([
                { label: 'Viram o botão', n: s.views, wide: true },
                { label: 'Abriram', n: s.opened, rate: rate(s.opened, s.views), wide: true },
                { label: 'Provaram', n: s.triedVisits, rate: rate(s.triedVisits, s.opened), wide: true },
                { label: 'Clicaram em Comprar', n: s.buys, rate: rate(s.buys, s.triedVisits), wide: true },
                { label: 'Compraram', n: s.sales, rate: rate(s.sales, s.triedVisits), wide: true, color: 'var(--data-1)' },
              ]),
              h('p', { class: 'muted note', text: 'Cada etapa conta visitas à loja. A porcentagem compara com a etapa anterior, e em Compraram compara com quem provou.' })),
            h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: 'Compartilhamentos' })),
              barList([
                { label: 'Links criados', n: s.shares, wide: true, color: 'var(--data-2)' },
                { label: 'Abriram o link', n: s.shareViews, wide: true, color: 'var(--data-2)' },
                { label: 'Foram à loja', n: s.shareClicks, rate: rate(s.shareClicks, s.shareViews), wide: true, color: 'var(--data-1)' },
              ]),
              h('p', { class: 'muted note', text: 'Quem abre o link compartilhado vê a prova e pode provar também ou ir direto ao produto.' }))),
          h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: 'Produtos mais provados' })),
            // no celular: nome e, logo abaixo, "95 provas · 13 vendas · 14% compraram" (data-short)
            s.top && s.top.length ? h('table', { class: 't top-t' },
              h('thead', null, h('tr', null, h('th', { text: 'Produto' }), h('th', { class: 'num', text: 'Provas' }), h('th', { class: 'num', text: 'Vendas' }), h('th', { class: 'num', text: '% que comprou' }))),
              h('tbody', null, s.top.map(function (p) {
                return h('tr', null, h('td', { text: p.name || ('#' + p.id) }),
                  h('td', { class: 'num', text: nf(p.tryons), 'data-short': Number(p.tryons) === 1 ? 'prova' : 'provas' }),
                  h('td', { class: 'num', text: nf(p.sales), 'data-short': Number(p.sales) === 1 ? 'venda' : 'vendas' }),
                  h('td', { class: 'num', text: p.tryons ? pct(p.sales / p.tryons) : '0%', 'data-short': 'compraram' }));
              }))) : h('p', { class: 'chart-empty', text: 'Ainda sem provas no período.' }),
            s.avgSeconds ? h('p', { class: 'muted note' }, icon('timer'), 'Tempo médio de uma prova: ' + String(s.avgSeconds).replace('.', ',') + ' s') : null,
            // celulares que fecham a página da loja ao abrir a câmera (Android com pouca memória)
            s.cameraOpens ? h('p', { class: 'muted note' }, 'Câmera do celular: em ' + pct(Math.min(1, s.cameraReloads / s.cameraOpens)) + ' das vezes o celular fechou a página (' + nf(s.cameraReloads) + ' de ' + nf(s.cameraOpens) + ').') : null),
        ]);
      }).catch(fail);
    }
    days.addEventListener('change', load);
    add(view, [pageHead('Visão geral', null, [days]), box]);
    load();
  }

  // ---------- leads ----------
  function renderLeads() {
    api('GET', '/tryon/leads?limit=500').then(function (r) {
      var leads = r.leads, on = !!(state.me.settings.tryon || {}).leadCapture;
      add(view, [
        pageHead('Leads', null,
          leads.length ? [chipBtn('Baixar planilha', 'download', downloadLeads)] : null),
        on ? null : h('div', { class: 'banner' }, icon('whatsapp'), h('div', { class: 'banner-t' }, h('b', { text: 'A captura de WhatsApp está desligada' }),
          h('span', { text: 'Ligue em Preferências: o comprador faz a primeira prova e informa o WhatsApp para continuar.' })),
          h('button', { class: 'btn sm primary', type: 'button', onclick: function () { go('prefs'); } }, 'Abrir Preferências', icon('arrow-right'))),
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: leads.length ? pl(leads.length, 'contato', 'contatos') : 'Contatos' })),
          leads.length ? h('table', { class: 't' },
            h('thead', null, h('tr', null, h('th', { text: 'WhatsApp' }), h('th', { text: 'Provou' }), h('th', { class: 'num', text: 'Provas' }), h('th', { class: 'hide-sm', text: 'Quando' }), h('th', { class: 'act' }))),
            h('tbody', null, leads.map(function (l) {
              var wa = 'https://wa.me/' + l.phone.replace(/\D/g, '');
              return h('tr', null,
                h('td', { text: fmtPhone(l.phone) }), h('td', { text: l.product_name || 'Sem produto' }), h('td', { class: 'num', text: nf(l.tryons) }),
                h('td', { class: 'hide-sm', text: fmtDate(l.created_at) }),
                h('td', { class: 'act' }, h('a', { class: 'chip-btn', href: wa, target: '_blank', rel: 'noopener' }, icon('whatsapp'), 'Conversar')));
            }))) : h('p', { class: 'chart-empty', text: on ? 'Os números aparecem aqui quando os compradores fizerem a segunda prova.' : 'Nenhum contato ainda.' })),
        h('p', { class: 'muted note', text: 'O comprador informou o WhatsApp para continuar provando.' }),
      ]);
    }).catch(fail);
  }

  // ---------- preferências ----------
  function renderPrefs() {
    var t = state.me.settings.tryon || {};
    var f = { enabled: t.enabled !== false, leadCapture: !!t.leadCapture, freeBeforeLead: t.freeBeforeLead == null ? 1 : t.freeBeforeLead, dailyPerShopper: t.dailyPerShopper || 10, buttonIcon: t.buttonIcon !== false, hideOutOfStock: t.hideOutOfStock !== false, showBrand: t.showBrand !== false, button: t.button || 'Provar em mim' };
    function sw(key, label, hint, locked) {
      var input = h('input', { type: 'checkbox', checked: f[key], disabled: !!locked, onchange: function (e) { f[key] = e.target.checked; } });
      return h('div', { class: 'pref' }, h('div', null, h('b', { text: label }), hint ? h('span', { class: 'muted', text: hint }) : null),
        h('label', { class: 'switch' }, input, h('span')));
    }
    var freeSel = h('select', { class: 'chip-btn', 'aria-label': 'Provas antes de pedir o WhatsApp', onchange: function (e) { f.freeBeforeLead = Number(e.target.value); } },
      [0, 1, 2, 3].map(function (n) { return h('option', { value: n, text: n === 0 ? 'Já na 1ª prova' : 'Depois de ' + pl(n, 'prova', 'provas'), selected: f.freeBeforeLead === n }); }));
    var dailyOpts = [3, 5, 10, 15, 20, 30, 50];
    if (dailyOpts.indexOf(f.dailyPerShopper) < 0) dailyOpts.push(f.dailyPerShopper);
    var dailySel = h('select', { class: 'chip-btn', 'aria-label': 'Provas por comprador por dia', onchange: function (e) { f.dailyPerShopper = Number(e.target.value); } },
      dailyOpts.sort(function (a, b) { return a - b; }).map(function (n) { return h('option', { value: n, text: pl(n, 'prova', 'provas'), selected: f.dailyPerShopper === n }); }));
    var btnText = h('input', { type: 'text', value: f.button, maxlength: '40', oninput: function (e) { f.button = e.target.value; } });
    add(view, [
      pageHead('Preferências'),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: 'Na loja' })),
        sw('enabled', 'Provador na loja', 'Mostra o botão nas páginas de produto com foto.'),
        sw('buttonIcon', 'Ícone no botão', 'Mostra o ícone antes do texto. Desligado, o botão fica só com o texto.'),
        sw('hideOutOfStock', 'Esconder em produtos sem estoque', 'O botão não aparece quando todas as opções do produto estão esgotadas. Assim nenhuma prova da cota vai para um produto que não dá para comprar.'),
        state.me.brandRemovable
          ? sw('showBrand', 'Marca Miaou no provador', 'Mostra "Provador virtual por Miaou" no rodapé do provador e do link compartilhado.')
          : sw('showBrand', 'Marca Miaou no provador', 'Para remover a marca, suba para o plano Escalar.', true),
        h('label', { class: 'f', style: 'margin:14px 0 0' }, 'Texto do botão', btnText)),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: 'WhatsApp' })),
        sw('leadCapture', 'Pedir o WhatsApp', 'O comprador faz as primeiras provas livre; para continuar, informa o WhatsApp. Os números ficam em Leads.'),
        h('div', { class: 'pref' }, h('div', null, h('b', { text: 'Quando pedir' }), h('span', { class: 'muted', text: 'Quantas provas o comprador faz antes.' })), freeSel)),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: 'Proteção do plano' })),
        h('div', { class: 'pref' }, h('div', null, h('b', { text: 'Provas por comprador por dia' }),
          h('span', { class: 'muted', text: 'Evita que uma pessoa sozinha gaste as provas do mês. Provas repetidas (mesma foto e mesmo produto) não contam.' })), dailySel)),
      installCard(),
      supportCard(),
      h('div', { class: 'row', style: 'justify-content:flex-end' }, h('button', { class: 'btn primary', text: 'Salvar', onclick: function () {
        api('PUT', '/settings', { tryon: { enabled: f.enabled, leadCapture: f.leadCapture, freeBeforeLead: f.freeBeforeLead, dailyPerShopper: f.dailyPerShopper, buttonIcon: f.buttonIcon, hideOutOfStock: f.hideOutOfStock, showBrand: f.showBrand, button: f.button.trim() } })
          .then(function () { toast('Preferências salvas'); return loadMe(); }).then(function () { go('prefs'); }).catch(fail);
      } })),
    ]);
  }

  // Suporte: e-mail da Miaou, com botão para copiar.
  function supportCard() {
    var mail = state.me.supportEmail || 'suporte@miaou.com.br';
    function copy() {
      var done = function () { toast('E-mail copiado'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(mail).then(done, function () { location.href = 'mailto:' + mail; });
      else location.href = 'mailto:' + mail;
    }
    return h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: 'Suporte' })),
      h('div', { class: 'pref' },
        h('div', null, h('b', null, h('a', { href: 'mailto:' + mail, class: 'mail', text: mail })),
          h('span', { class: 'muted', text: 'Dúvidas, instalação ou algo que não funcionou: escreva para a gente.' })),
        h('button', { class: 'chip-btn', type: 'button', onclick: copy }, 'Copiar e-mail')));
  }

  // Onde o botão está instalado: script automático (Portal de Parceiros) ou linha manual no tema.
  function installCard() {
    var me = state.me;
    return h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: 'Instalação na loja' }),
      h('span', { class: 'chip' + (me.scriptInstalled ? ' ok' : ' warn'), text: me.scriptInstalled ? 'Instalado' : 'Não instalado' })),
      me.scriptInstalled ? h('p', { class: 'muted', style: 'margin:0', text: 'O botão aparece sozinho nas páginas de produto, e as vendas feitas depois de uma prova entram no painel.' })
        : h('div', null,
          me.scriptConfigured ? h('p', null, h('button', { class: 'btn sm primary', type: 'button', text: 'Instalar na loja', onclick: installScript })) : null,
          h('p', { class: 'muted', text: 'Ou cole esta linha no código do tema (Minha Nuvemshop › Layout › Editar código, antes de </body>):' }),
          h('p', { style: 'margin:0' }, h('code', { text: '<script src="' + me.loaderUrl + '" async></script>' }))));
  }

  // ---------- planos ----------
  // Cartões grandes (preço em destaque, cota, o que inclui, botão largo). O
  // plano mais escolhido fica escuro. Acima do maior, o Volume: uma barra com
  // degraus fixos, cada um com preço por prova menor.
  // desconto por prova em relação ao plano de entrada (só quando existe)
  function saving(p, base) {
    var pct = Math.round((1 - (p.price / p.quota) / (base.price / base.quota)) * 100);
    return pct >= 5 ? pct : 0;
  }
  function renderPlan() {
    api('GET', '/tryon?days=30').then(function (r) {
      var q = r.quota;
      var usedPct = q.plan.quota ? Math.min(1, q.used / q.plan.quota) : 0;
      var contact = 'mailto:' + (state.me.supportEmail || 'suporte@miaou.com.br') + '?subject=' + encodeURIComponent('Plano do provador · loja ' + state.me.store.id);
      var ladder = r.plans.concat(r.volume || []);
      var curIdx = ladder.findIndex(function (p) { return p.key === q.plan.key; });
      function choose(p) {
        if (!r.allowSelfPlan) { location.href = contact; return; }
        api('PUT', '/tryon/plan', { plan: p.key }).then(function () { toast('Plano ' + planLabel(p) + ' ativado'); return loadMe(); }).then(function () { go('plan'); }).catch(fail);
      }
      function planLabel(p) { return p.volume ? 'Volume ' + nf(p.quota) : p.name; }
      function actionText(p) {
        if (!r.allowSelfPlan) return 'Falar com a Miaou';
        if (curIdx < 0) return 'Escolher plano';
        return ladder.indexOf(p) > curIdx ? 'Subir de plano' : 'Mudar de plano';
      }
      var base = r.plans[0];
      function saveChip(p) {
        var pct = saving(p, base);
        return h('div', { class: 'pc-save' }, pct ? h('span', { text: 'Prova ' + pct + '% mais barata' }) : null);
      }
      function planButton(p, dark) {
        var cur = p.key === q.plan.key;
        return h('button', { class: 'pc-btn' + (dark ? ' light' : ''), type: 'button', disabled: cur, onclick: function () { choose(p); } },
          cur ? 'Seu plano atual' : [actionText(p), icon('arrow-right')]);
      }
      function feats(list) {
        return h('ul', { class: 'pc-feat' }, (list || []).map(function (x) { return h('li', null, icon('check'), x); }));
      }
      var cards = r.plans.map(function (p) {
        var cur = p.key === q.plan.key;
        var dark = !!p.featured;
        var tag = cur ? h('span', { class: 'pc-pill', text: 'Seu plano' })
          : p.featured ? h('span', { class: 'pc-pill', text: 'Mais escolhido' }) : null;
        return h('div', { class: 'price-card' + (dark ? ' dark' : '') + (cur ? ' on' : '') },
          h('div', { class: 'pc-head' }, h('h3', { text: p.name }), tag),
          h('div', { class: 'pc-price' }, h('b', { text: brl(p.price) }), h('span', { text: '/ mês' })),
          h('p', { class: 'pc-tag', text: p.tagline }),
          h('hr'),
          h('div', { class: 'pc-quota' }, h('b', { text: nf(p.quota) }), h('span', { text: 'provas / mês' })),
          saveChip(p),
          h('hr'),
          feats(p.features),
          planButton(p, dark));
      });

      // Volume: barra com os degraus acima do maior plano
      var vol = r.volume || [];
      var volBox = null;
      if (vol.length) {
        var at = Math.max(0, vol.findIndex(function (p) { return p.key === q.plan.key; }));
        var priceB = h('b'), quotaB = h('b'), saveSlot = h('div'), btnSlot = h('div', { class: 'pc-btn-slot' });
        var range = h('input', { type: 'range', min: '0', max: String(vol.length - 1), step: '1', value: String(at), class: 'vol-range', 'aria-label': 'Provas por mês no plano Volume' });
        var ticks = h('div', { class: 'vol-ticks' }, vol.map(function (p, i) {
          return h('button', { type: 'button', text: nf(p.quota), onclick: function () { range.value = String(i); paint(); } });
        }));
        var curVol = vol.some(function (p) { return p.key === q.plan.key; });
        var pill = h('span', { class: 'pc-pill', text: curVol ? 'Seu plano' : 'Acima de ' + nf(r.plans[r.plans.length - 1].quota) + ' provas' });
        function paint() {
          var i = Number(range.value);
          var p = vol[i];
          range.style.setProperty('--fill', (i / (vol.length - 1) * 100) + '%');
          priceB.textContent = brl(p.price);
          quotaB.textContent = nf(p.quota);
          saveSlot.innerHTML = '';
          saveSlot.appendChild(saveChip(p));
          range.setAttribute('aria-valuetext', nf(p.quota) + ' provas por ' + brl(p.price) + ' ao mês');
          Array.prototype.forEach.call(ticks.children, function (b, k) { b.className = k === i ? 'on' : ''; });
          btnSlot.innerHTML = '';
          btnSlot.appendChild(planButton(p, false));
        }
        range.addEventListener('input', paint);
        volBox = h('div', { class: 'price-card vol' + (curVol ? ' on' : '') },
          h('div', { class: 'vol-l' },
            h('div', { class: 'pc-head' }, h('h3', { text: 'Volume' }), pill),
            h('p', { class: 'pc-tag', text: 'Escolha exatamente quantas provas sua loja precisa.' }),
            h('div', { class: 'vol-slider' }, range, ticks),
            feats(vol[0].features)),
          h('div', { class: 'vol-r' },
            h('div', { class: 'pc-price' }, priceB, h('span', { text: '/ mês' })),
            h('div', { class: 'pc-quota' }, quotaB, h('span', { text: 'provas / mês' })),
            saveSlot,
            btnSlot));
        paint();
      }

      var meter = h('div', { class: 'meter' + (q.exhausted ? ' bad' : q.alert ? ' warn' : '') }, h('i', { style: 'width:' + Math.round(usedPct * 100) + '%' }));
      add(view, [
        pageHead('Planos'),
        q.plan.key !== 'none' ? h('div', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', { text: 'Uso deste mês' }), h('span', { class: 'chip', text: 'Plano ' + (q.plan.key.indexOf('volume-') === 0 ? 'Volume ' + nf(q.plan.quota) : q.plan.name) })),
          h('div', { class: 'usage' }, h('b', { text: nf(q.used) }), h('span', { text: 'de ' + nf(q.plan.quota) + ' provas' })),
          meter,
          h('p', { class: 'muted', style: 'margin:10px 0 0', text: 'Renova em ' + renewText() + '. Quando as provas do mês acabam, o botão sai da loja até renovar.' })) : quotaBanner(q),
        h('div', { class: 'pricing' }, cards),
        volBox,
        h('p', { class: 'muted note pc-note', text: 'Preços em reais, cobrança mensal. A cota renova todo dia 1º.' }),
      ]);
    }).catch(fail);
  }

  function prevText(now, before, fmt) {
    if (before == null) return 'últimos 30 dias';
    return 'Anteriormente ' + (fmt || nf)(before);
  }
  function upFlag(now, before) {
    if (before == null || now === before) return null;
    return now > before;
  }
  function syncProducts(e) {
    var b = e.currentTarget; b.disabled = true; b.textContent = 'Sincronizando…';
    api('POST', '/products/sync').then(function (r) { toast(r.count + ' produtos sincronizados'); return loadMe(); })
      .then(function () { go(currentTab() || 'tryon'); }).catch(function (err) { fail(err); b.disabled = false; b.textContent = 'Sincronizar agora'; });
  }
  function installScript() {
    api('POST', '/script/install').then(function () { toast('Script instalado'); return loadMe(); })
      .then(function () { go(currentTab() || 'tryon'); }).catch(fail);
  }

  // ---------- produtos ----------
  var KIND = { garment: 'Roupa', glasses: 'Óculos' };
  function renderProducts() {
    var PER_PAGE = 20;
    var page = 1;
    var search = h('input', { type: 'search', placeholder: 'Nome ou nº do produto', 'aria-label': 'Buscar produto por nome ou número' });
    var box = h('div', { class: 'card' });
    var pager = h('div', { class: 'pager' });
    function renderPager(total) {
      pager.innerHTML = '';
      var pages = Math.max(1, Math.ceil(total / PER_PAGE));
      if (total <= PER_PAGE) return;   // uma página só: sem rodapé
      var first = (page - 1) * PER_PAGE + 1;
      var last = Math.min(page * PER_PAGE, total);
      add(pager, [
        h('button', { class: 'chip-btn', type: 'button', disabled: page <= 1, 'aria-label': 'Página anterior',
          onclick: function () { if (page > 1) { page--; load(); } } }, icon('chevron-left'), 'Anterior'),
        h('span', { class: 'pager-info', text: nf(first) + ' a ' + nf(last) + ' de ' + pl(total, 'produto', 'produtos') }),
        h('button', { class: 'chip-btn', type: 'button', disabled: page >= pages, 'aria-label': 'Próxima página',
          onclick: function () { if (page < pages) { page++; load(); } } }, 'Próxima', icon('chevron-right')),
      ]);
    }
    function load() {
      var q = '/products?limit=' + PER_PAGE + '&offset=' + ((page - 1) * PER_PAGE) + '&search=' + encodeURIComponent(search.value.trim());
      api('GET', q).then(function (r) {
        if (!r.items.length && r.total && page > 1) { page = Math.ceil(r.total / PER_PAGE); load(); return; }
        box.innerHTML = '';
        renderPager(r.total);
        if (!r.items.length) { add(box, h('p', { class: 'empty', text: 'Nenhum produto encontrado.' })); return; }
        add(box, h('table', { class: 't' },
          h('thead', null, h('tr', null, h('th', { class: 'hide-sm' }), h('th', { text: 'Produto' }), h('th', { text: 'Provador virtual' }))),
          h('tbody', null, r.items.map(function (p) {
            // automático: reconhece óculos pelo nome; dá para forçar ou desligar
            var kindSel = h('select', { 'aria-label': 'Provador virtual de ' + p.name },
              [['', 'Automático (' + (KIND[p.tryon_auto] || 'desligado') + ')'], ['garment', 'Roupa'], ['glasses', 'Óculos'], ['off', 'Desligado']].map(function (o) {
                return h('option', { value: o[0], text: o[1], selected: (p.tryon_kind || '') === o[0] });
              }));
            kindSel.addEventListener('change', function () {
              api('PUT', '/products/' + p.id + '/tryon', { kind: kindSel.value || null })
                .then(function () { toast('Produto atualizado'); }).catch(fail);
            });
            var noImg = !p.image ? h('div', null, h('span', { class: 'chip warn', text: 'sem foto: o botão não aparece' })) : null;
            return h('tr', null,
              h('td', { class: 'hide-sm' }, p.image ? h('img', { class: 'thumb', src: p.image, alt: '' }) : h('span', { class: 'thumb', style: 'display:inline-block' })),
              h('td', null, h('b', { text: p.name }), h('div', { class: 'muted', text: p.categories.map(function (c) { return c.name; }).join(', ') })),
              h('td', null, kindSel, noImg));
          }))));
        box.appendChild(pager);   // rodapé do cartão, abaixo da tabela
      }).catch(fail);
    }
    var t;
    search.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { page = 1; load(); }, 250); });
    load();
    add(view, [
      pageHead('Produtos', null,
        [chipBtn('Sincronizar catálogo', 'refresh', syncProducts)]),
      h('div', { class: 'row filters', style: 'margin-bottom:12px' }, search),
      box,
    ]);
  }

  // ---------- início ----------
  var enabled = document.getElementById('enabled');
  enabled.addEventListener('change', function () {
    api('PUT', '/settings', { enabled: enabled.checked }).then(function (r) {
      state.me.settings = r.settings;
      document.getElementById('enabledLabel').textContent = enabled.checked ? 'Ativo na loja' : 'Desativado';
      toast(enabled.checked ? 'Provador ativado na loja' : 'Provador desativado');
    }).catch(fail);
  });

  function loadMe() {
    return api('GET', '/me').then(function (me) {
      state.me = me;
      var sn = document.getElementById('storeName');
      if (sn) sn.textContent = me.store.name || ('Loja #' + me.store.id);
      enabled.checked = me.settings.enabled;
      document.getElementById('enabledLabel').textContent = me.settings.enabled ? 'Ativo na loja' : 'Desativado';
    });
  }
  function currentTab() {
    var b = tabs.querySelector('[aria-selected="true"]');
    return b && !b.hidden ? b.getAttribute('data-tab') : null;
  }

  (function chrome() {
    var navIco = document.getElementById('navIco');
    if (navIco) navIco.appendChild(icon('menu'));
    // ícone de cada item do menu lateral
    Array.prototype.forEach.call(tabs.children, function (b) {
      var name = b.getAttribute('data-icon');
      if (name) b.insertBefore(icon(name), b.firstChild);
    });

    // gaveta do celular
    var btn = document.getElementById('btnNav');
    var scrim = document.getElementById('scrim');
    function setNav(open) {
      document.body.classList.toggle('nav-open', open);
      if (btn) btn.setAttribute('aria-expanded', String(open));
      if (btn) btn.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    }
    if (btn) btn.addEventListener('click', function () { setNav(!document.body.classList.contains('nav-open')); });
    if (scrim) scrim.addEventListener('click', function () { setNav(false); });
    tabs.addEventListener('click', function () { setNav(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setNav(false); });
  })();

  if (!TOKEN) { showExpired(); return; }
  loadMe().then(function () {
    go('tryon');
  }).catch(function (e) { if (state.me) fail(e); });
})();
