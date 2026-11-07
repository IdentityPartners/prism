/**
 * Argentica Canvas — SVG Rendering Blocks
 * Worker: prism-api.identitypartners.workers.dev
 * Drop these cases into the existing renderCanvas(template, data, env) switch statement.
 *
 * Brand colours:
 *   Deep Teal   #0f3b3a   Deep Rose   #5c2d3f
 *   Warm Ivory  #f7f3e9   Warm Grey   #ddd0c8
 *   Teal Light  #7ecfcd   Rose Light  #d4899a
 *
 * Fonts (Google Fonts, loaded in <defs>):
 *   Playfair Display — headings, quotes, brand name
 *   Inter            — body, captions, URLs
 *
 * Mandatory on every canvas:
 *   ipLogo()  real PNG from prism.identitypartners.uk/shared/assets/logo-square.png
 *   identitypartners.uk
 *   hello@identitypartners.uk
 *   IP social handles
 *
 * Canvas dimensions: 1080 × 1080 (square, Instagram/LinkedIn safe)
 *
 * Usage:
 *   const svg = await renderCanvas(template, data, env);
 *   // upload svg to R2, return public URL
 */

// ─────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────

const W = 1080;
const H = 1080;

const LOGO_URL = 'https://prism.identitypartners.uk/shared/assets/logo-square.png';

const COLOURS = {
  deepTeal:   '#0f3b3a',
  deepRose:   '#5c2d3f',
  warmIvory:  '#f7f3e9',
  warmGrey:   '#ddd0c8',
  tealLight:  '#7ecfcd',
  roseLight:  '#d4899a',
  white:      '#ffffff',
  black:      '#000000',
};

/** Google Fonts <defs> block — embed in every SVG */
function fontDefs() {
  return `<defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&amp;family=Inter:wght@400;500;600;700&amp;display=swap');
      text { font-family: 'Inter', Arial, sans-serif; }
      .playfair { font-family: 'Playfair Display', Georgia, serif; }
    </style>
  </defs>`;
}

/** IP logo — real PNG, bottom-left, 72×72 */
function ipLogo(x = 40, y = H - 112) {
  return `<image href="${LOGO_URL}" x="${x}" y="${y}" width="72" height="72" preserveAspectRatio="xMidYMid meet"/>`;
}

/**
 * Footer bar — logo + URL + email + handles
 * Sits at the bottom of every canvas.
 * bgColour: fill behind the footer strip
 * textColour: text colour
 */
function footer(bgColour = COLOURS.deepTeal, textColour = COLOURS.warmIvory) {
  const y = H - 80;
  return `
  <rect x="0" y="${y}" width="${W}" height="80" fill="${bgColour}"/>
  ${ipLogo(32, y + 4)}
  <text x="120" y="${y + 28}" fill="${textColour}" font-size="22" font-weight="600" class="playfair">Identity Partners</text>
  <text x="120" y="${y + 52}" fill="${textColour}" font-size="16" opacity="0.85">identitypartners.uk · hello@identitypartners.uk</text>
  <text x="${W - 32}" y="${y + 40}" fill="${textColour}" font-size="15" opacity="0.75" text-anchor="end">@identitypartners · @IdentityPtnrs</text>`;
}

/** Wrap text into tspan lines at maxWidth chars */
function wrapText(text, maxChars) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > maxChars) {
      if (line) lines.push(line.trim());
      line = word;
    } else {
      line = (line + ' ' + word).trim();
    }
  }
  if (line) lines.push(line.trim());
  return lines;
}

/** Render wrapped tspan lines from a start y, with given dy */
function tspans(lines, x, startY, dy, attrs = '') {
  return lines.map((l, i) =>
    `<tspan x="${x}" dy="${i === 0 ? 0 : dy}" ${attrs}>${escXml(l)}</tspan>`
  ).join('');
}

function escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** SVG wrapper */
function svgWrap(content, bg = COLOURS.deepTeal) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${fontDefs()}
  <rect width="${W}" height="${H}" fill="${bg}"/>
  ${content}
</svg>`;
}


// ─────────────────────────────────────────────
// TEMPLATE 1: myth-vs-fact-teal / myth-vs-fact-ivory
// ─────────────────────────────────────────────
//
// data = {
//   myth:    string   — the myth statement
//   fact:    string   — the fact statement
//   source:  string   — optional source attribution
//   variant: 'teal' | 'ivory'
// }
//
// Layout:
//   Top bar: "MYTH vs FACT" header
//   Left panel (rose): MYTH label + myth text
//   Right panel (teal): FACT label + fact text
//   Divider line centre
//   Footer: logo + URL + handles
//   Source attribution above footer if provided

function renderMythVsFact(data) {
  const isTeal = data.variant !== 'ivory';
  const outerBg   = isTeal ? COLOURS.deepTeal  : COLOURS.warmIvory;
  const headerBg  = isTeal ? COLOURS.deepRose  : COLOURS.deepRose;
  const mythBg    = isTeal ? '#3a1a24'          : '#f0dde3';
  const factBg    = isTeal ? '#0a2827'          : '#d6eeee';
  const mythText  = isTeal ? COLOURS.warmIvory  : COLOURS.deepRose;
  const factText  = isTeal ? COLOURS.warmIvory  : COLOURS.deepTeal;
  const labelMythC = COLOURS.roseLight;
  const labelFactC = COLOURS.tealLight;
  const footerBg  = isTeal ? COLOURS.deepTeal  : COLOURS.deepTeal;

  const panelTop    = 140;
  const panelBottom = H - 80;
  const panelH      = panelBottom - panelTop;
  const halfW       = W / 2;

  const mythLines = wrapText(data.myth || '', 28);
  const factLines = wrapText(data.fact || '', 28);

  const textY = panelTop + 100;

  const sourceBlock = data.source
    ? `<text x="${W / 2}" y="${panelBottom - 16}" text-anchor="middle"
             fill="${isTeal ? COLOURS.warmGrey : COLOURS.deepTeal}"
             font-size="18" opacity="0.65">Source: ${escXml(data.source)}</text>`
    : '';

  const content = `
  <!-- Header bar -->
  <rect x="0" y="0" width="${W}" height="${panelTop}" fill="${headerBg}"/>
  <text x="${W / 2}" y="88" text-anchor="middle" fill="${COLOURS.warmIvory}"
        font-size="52" font-weight="900" class="playfair" letter-spacing="4">MYTH vs FACT</text>

  <!-- Myth panel (left) -->
  <rect x="0" y="${panelTop}" width="${halfW}" height="${panelH}" fill="${mythBg}"/>

  <!-- Fact panel (right) -->
  <rect x="${halfW}" y="${panelTop}" width="${halfW}" height="${panelH}" fill="${factBg}"/>

  <!-- Centre divider -->
  <rect x="${halfW - 2}" y="${panelTop}" width="4" height="${panelH}" fill="${COLOURS.warmGrey}" opacity="0.3"/>

  <!-- MYTH label -->
  <text x="${halfW / 2}" y="${panelTop + 60}" text-anchor="middle"
        fill="${labelMythC}" font-size="28" font-weight="700" letter-spacing="6">MYTH</text>
  <rect x="${halfW / 2 - 40}" y="${panelTop + 70}" width="80" height="3" fill="${labelMythC}" rx="2"/>

  <!-- Myth text -->
  <text x="${halfW / 2}" y="${textY}" text-anchor="middle"
        fill="${mythText}" font-size="30" font-weight="400" class="playfair">
    ${tspans(mythLines, halfW / 2, textY, 42, 'text-anchor="middle"')}
  </text>

  <!-- FACT label -->
  <text x="${halfW + halfW / 2}" y="${panelTop + 60}" text-anchor="middle"
        fill="${labelFactC}" font-size="28" font-weight="700" letter-spacing="6">FACT</text>
  <rect x="${halfW + halfW / 2 - 40}" y="${panelTop + 70}" width="80" height="3" fill="${labelFactC}" rx="2"/>

  <!-- Fact text -->
  <text x="${halfW + halfW / 2}" y="${textY}" text-anchor="middle"
        fill="${factText}" font-size="30" font-weight="400" class="playfair">
    ${tspans(factLines, halfW + halfW / 2, textY, 42, 'text-anchor="middle"')}
  </text>

  ${sourceBlock}
  ${footer(footerBg, COLOURS.warmIvory)}`;

  return svgWrap(content, outerBg);
}


// ─────────────────────────────────────────────
// TEMPLATE 2: data-infographic
// ─────────────────────────────────────────────
//
// data = {
//   title:       string
//   subtitle:    string   — optional
//   points: [
//     { label: string, value: number, unit: string, max: number }
//     // 3–5 points; max is the scale ceiling for the bar
//   ]
//   source:      string   — attribution line
// }
//
// Layout:
//   Deep teal background
//   Title + subtitle top
//   Horizontal bar chart: label left, bar centre, value right
//   Source attribution
//   Footer

function renderDataInfographic(data) {
  const bg = COLOURS.deepTeal;
  const points = (data.points || []).slice(0, 5);
  const n = points.length;

  const titleY    = 100;
  const subtitleY = 155;
  const chartTop  = data.subtitle ? 210 : 180;
  const chartBot  = H - 120;
  const rowH      = Math.floor((chartBot - chartTop) / Math.max(n, 1));
  const barLeft   = 320;
  const barRight  = W - 160;
  const barMaxW   = barRight - barLeft;
  const barH      = Math.min(48, rowH - 28);

  const titleLines = wrapText(data.title || '', 36);

  const bars = points.map((pt, i) => {
    const globalMax = Math.max(...points.map(p => p.max || p.value || 1));
    const pct = Math.min(1, (pt.value || 0) / (pt.max || globalMax || 1));
    const bw  = Math.round(pct * barMaxW);
    const cy  = chartTop + i * rowH + rowH / 2;
    const labelLines = wrapText(pt.label || '', 18);

    // Alternate teal/rose bars for visual rhythm
    const barFill = i % 2 === 0 ? COLOURS.tealLight : COLOURS.roseLight;

    return `
    <!-- Bar ${i + 1} -->
    <text x="${barLeft - 20}" y="${cy + 6}" text-anchor="end"
          fill="${COLOURS.warmIvory}" font-size="22" font-weight="500">
      ${tspans(labelLines, barLeft - 20, cy + 6, 26, 'text-anchor="end"')}
    </text>
    <rect x="${barLeft}" y="${cy - barH / 2}" width="${barMaxW}" height="${barH}"
          fill="${COLOURS.white}" opacity="0.08" rx="6"/>
    <rect x="${barLeft}" y="${cy - barH / 2}" width="${bw}" height="${barH}"
          fill="${barFill}" rx="6"/>
    <text x="${barLeft + bw + 14}" y="${cy + 8}"
          fill="${barFill}" font-size="26" font-weight="700">${escXml(pt.value)}${escXml(pt.unit || '')}</text>`;
  }).join('');

  const sourceY = chartBot + 20;

  const content = `
  <!-- Title -->
  <text x="${W / 2}" y="${titleY}" text-anchor="middle"
        fill="${COLOURS.warmIvory}" font-size="48" font-weight="900" class="playfair">
    ${tspans(titleLines, W / 2, titleY, 56, 'text-anchor="middle"')}
  </text>

  ${data.subtitle
    ? `<text x="${W / 2}" y="${subtitleY}" text-anchor="middle"
             fill="${COLOURS.tealLight}" font-size="26" font-weight="500">${escXml(data.subtitle)}</text>`
    : ''}

  <!-- Divider -->
  <rect x="60" y="${chartTop - 20}" width="${W - 120}" height="2"
        fill="${COLOURS.tealLight}" opacity="0.3" rx="1"/>

  ${bars}

  <!-- Source -->
  <text x="${W / 2}" y="${sourceY}" text-anchor="middle"
        fill="${COLOURS.warmGrey}" font-size="18" opacity="0.6">Source: ${escXml(data.source || '')}</text>

  ${footer(COLOURS.deepTeal, COLOURS.warmIvory)}`;

  return svgWrap(content, bg);
}


// ─────────────────────────────────────────────
// TEMPLATE 3: awareness-day / awareness-day-rose
// ─────────────────────────────────────────────
//
// data = {
//   campaignName:  string   — e.g. "World Mental Health Day"
//   date:          string   — e.g. "10 October 2026"
//   message:       string   — IP's specific message (not generic)
//   imageBase64:   string   — base64 image from semanticImageSearch(), optional
//   variant:       'teal' | 'rose'
// }
//
// Layout:
//   Full-bleed background image (if provided) with dark overlay
//   OR solid brand colour background
//   Campaign name — large Playfair, centred
//   Date — teal/rose light, below campaign name
//   IP message — body text, lower third
//   Footer

function renderAwarenessDay(data) {
  const isRose = data.variant === 'rose';
  const bg      = isRose ? COLOURS.deepRose : COLOURS.deepTeal;
  const accent  = isRose ? COLOURS.roseLight : COLOURS.tealLight;
  const overlay = isRose ? 'rgba(92,45,63,0.72)' : 'rgba(15,59,58,0.72)';

  const campaignLines = wrapText(data.campaignName || '', 22);
  const messageLines  = wrapText(data.message || '', 38);

  const hasImage = !!data.imageBase64;

  const imageBlock = hasImage
    ? `<image href="data:image/jpeg;base64,${data.imageBase64}"
               x="0" y="0" width="${W}" height="${H}"
               preserveAspectRatio="xMidYMid slice"/>
       <rect width="${W}" height="${H}" fill="${overlay}"/>`
    : '';

  // Decorative ribbon behind campaign name
  const ribbonY = 280;
  const ribbonH = campaignLines.length * 90 + 40;

  const campaignY = ribbonY + 70;

  const messageY = 720;

  const content = `
  ${imageBlock}

  <!-- Decorative top accent line -->
  <rect x="60" y="60" width="${W - 120}" height="5" fill="${accent}" rx="3"/>

  <!-- Campaign name ribbon -->
  <rect x="0" y="${ribbonY - 20}" width="${W}" height="${ribbonH}"
        fill="${bg}" opacity="${hasImage ? '0.55' : '0'}"/>

  <text x="${W / 2}" y="${campaignY}" text-anchor="middle"
        fill="${COLOURS.warmIvory}" font-size="80" font-weight="900" class="playfair"
        letter-spacing="-1">
    ${tspans(campaignLines, W / 2, campaignY, 90, 'text-anchor="middle"')}
  </text>

  <!-- Date -->
  <text x="${W / 2}" y="${campaignY + campaignLines.length * 90 + 10}"
        text-anchor="middle" fill="${accent}" font-size="32" font-weight="600"
        letter-spacing="3">${escXml((data.date || '').toUpperCase())}</text>

  <!-- Divider -->
  <rect x="${W / 2 - 60}" y="${messageY - 30}" width="120" height="3"
        fill="${accent}" rx="2"/>

  <!-- IP message -->
  <text x="${W / 2}" y="${messageY}" text-anchor="middle"
        fill="${COLOURS.warmIvory}" font-size="30" font-weight="400" class="playfair"
        opacity="0.92">
    ${tspans(messageLines, W / 2, messageY, 42, 'text-anchor="middle"')}
  </text>

  <!-- Bottom accent line -->
  <rect x="60" y="${H - 88}" width="${W - 120}" height="3" fill="${accent}" opacity="0.4" rx="2"/>

  ${footer(bg, COLOURS.warmIvory)}`;

  return svgWrap(content, bg);
}


// ─────────────────────────────────────────────
// TEMPLATE 4: news-reaction
// ─────────────────────────────────────────────
//
// data = {
//   outlet:      string   — e.g. "The Guardian"
//   headline:    string   — the actual headline (verbatim)
//   commentary:  string   — IP's commentary on what it means
//   date:        string   — publication date
// }
//
// Layout:
//   Near-black background (#0a0f0f)
//   Top: outlet name + date (small, muted)
//   Headline: medium weight, warm grey, italic
//   Horizontal rule
//   Commentary: large Playfair, ivory, dominant
//   Footer: teal strip

function renderNewsReaction(data) {
  const bg = '#0a0f0f';

  const headlineLines   = wrapText(data.headline || '', 44);
  const commentaryLines = wrapText(data.commentary || '', 32);

  const outletY    = 90;
  const headlineY  = 170;
  const ruleY      = headlineY + headlineLines.length * 36 + 30;
  const commentY   = ruleY + 60;

  const content = `
  <!-- Outlet + date -->
  <text x="60" y="${outletY}" fill="${COLOURS.tealLight}"
        font-size="22" font-weight="700" letter-spacing="2">${escXml((data.outlet || '').toUpperCase())}</text>
  <text x="${W - 60}" y="${outletY}" text-anchor="end"
        fill="${COLOURS.warmGrey}" font-size="20" opacity="0.6">${escXml(data.date || '')}</text>

  <!-- Headline -->
  <text x="60" y="${headlineY}" fill="${COLOURS.warmGrey}"
        font-size="30" font-style="italic" class="playfair">
    ${tspans(headlineLines, 60, headlineY, 38)}
  </text>

  <!-- Rule -->
  <rect x="60" y="${ruleY}" width="${W - 120}" height="2"
        fill="${COLOURS.tealLight}" opacity="0.4" rx="1"/>

  <!-- IP label -->
  <text x="60" y="${ruleY + 36}" fill="${COLOURS.tealLight}"
        font-size="18" font-weight="700" letter-spacing="3">IDENTITY PARTNERS</text>

  <!-- Commentary — dominant text -->
  <text x="60" y="${commentY}" fill="${COLOURS.warmIvory}"
        font-size="42" font-weight="700" class="playfair">
    ${tspans(commentaryLines, 60, commentY, 54)}
  </text>

  <!-- Left accent bar -->
  <rect x="0" y="${ruleY}" width="6" height="${H - ruleY - 80}"
        fill="${COLOURS.tealLight}" opacity="0.6"/>

  ${footer(COLOURS.deepTeal, COLOURS.warmIvory)}`;

  return svgWrap(content, bg);
}


// ─────────────────────────────────────────────
// TEMPLATE 5: service-explainer
// ─────────────────────────────────────────────
//
// data = {
//   serviceName:   string   — e.g. "One-to-One Relational Support"
//   description:   string   — plain language, 2–4 sentences
//   whoFor:        string   — optional: "For people navigating…"
//   contact:       string   — optional override, defaults to standard IP contact
// }
//
// Layout:
//   Warm ivory background
//   Deep teal header band with service name
//   Description body — deep teal text, generous leading
//   Who it's for — rose accent
//   Contact block
//   Footer — deep teal

function renderServiceExplainer(data) {
  const bg = COLOURS.warmIvory;

  const nameLines = wrapText(data.serviceName || '', 28);
  const descLines = wrapText(data.description || '', 42);
  const whoLines  = data.whoFor ? wrapText(data.whoFor, 48) : [];

  const headerH = 60 + nameLines.length * 72;
  const descY   = headerH + 80;
  const whoY    = descY + descLines.length * 44 + 50;
  const contactY = whoY + (whoLines.length > 0 ? whoLines.length * 36 + 40 : 0);

  const contact = data.contact || 'identitypartners.uk · hello@identitypartners.uk';

  const content = `
  <!-- Header band -->
  <rect x="0" y="0" width="${W}" height="${headerH}" fill="${COLOURS.deepTeal}"/>

  <!-- Service name -->
  <text x="${W / 2}" y="80" text-anchor="middle"
        fill="${COLOURS.warmIvory}" font-size="60" font-weight="900" class="playfair">
    ${tspans(nameLines, W / 2, 80, 72, 'text-anchor="middle"')}
  </text>

  <!-- Accent line below header -->
  <rect x="60" y="${headerH}" width="${W - 120}" height="5"
        fill="${COLOURS.tealLight}" rx="3"/>

  <!-- Description -->
  <text x="60" y="${descY}" fill="${COLOURS.deepTeal}"
        font-size="32" font-weight="400" class="playfair">
    ${tspans(descLines, 60, descY, 46)}
  </text>

  ${whoLines.length > 0 ? `
  <!-- Who it's for -->
  <rect x="60" y="${whoY - 36}" width="6" height="${whoLines.length * 36 + 12}"
        fill="${COLOURS.roseLight}" rx="3"/>
  <text x="84" y="${whoY}" fill="${COLOURS.deepRose}"
        font-size="26" font-weight="500">
    ${tspans(whoLines, 84, whoY, 36)}
  </text>` : ''}

  <!-- Contact -->
  <text x="${W / 2}" y="${Math.min(contactY, H - 120)}" text-anchor="middle"
        fill="${COLOURS.deepTeal}" font-size="24" font-weight="600" opacity="0.7">
    ${escXml(contact)}
  </text>

  ${footer(COLOURS.deepTeal, COLOURS.warmIvory)}`;

  return svgWrap(content, bg);
}


// ─────────────────────────────────────────────
// TEMPLATE 6: semantic-teal / semantic-rose / semantic-dark
// ─────────────────────────────────────────────
//
// data = {
//   text:        string   — centred overlay text (headline or quote)
//   subtext:     string   — optional secondary line
//   imageBase64: string   — base64 from semanticImageSearch()
//   variant:     'teal' | 'rose' | 'dark'
// }
//
// Layout:
//   Full-bleed semantic image
//   Gradient overlay (bottom-heavy, brand colour)
//   Text centred in lower half
//   IP logo bottom centre above footer
//   Footer strip

function renderSemanticImage(data) {
  const variant = data.variant || 'teal';

  const overlayColours = {
    teal: `rgba(15,59,58,0.78)`,
    rose: `rgba(92,45,63,0.78)`,
    dark: `rgba(10,15,15,0.82)`,
  };
  const accentColours = {
    teal: COLOURS.tealLight,
    rose: COLOURS.roseLight,
    dark: COLOURS.tealLight,
  };
  const footerBgs = {
    teal: COLOURS.deepTeal,
    rose: COLOURS.deepRose,
    dark: '#0a0f0f',
  };

  const overlay = overlayColours[variant];
  const accent  = accentColours[variant];
  const footerBg = footerBgs[variant];

  const textLines    = wrapText(data.text || '', 26);
  const subtextLines = data.subtext ? wrapText(data.subtext, 40) : [];

  const textY    = 620;
  const subtextY = textY + textLines.length * 68 + 20;

  const hasImage = !!data.imageBase64;

  const imageBlock = hasImage
    ? `<image href="data:image/jpeg;base64,${data.imageBase64}"
               x="0" y="0" width="${W}" height="${H}"
               preserveAspectRatio="xMidYMid slice"/>`
    : `<rect width="${W}" height="${H}" fill="${footerBg}"/>`;

  const content = `
  ${imageBlock}

  <!-- Gradient overlay — full bleed, bottom-heavy -->
  <defs>
    <linearGradient id="ovGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="${footerBg}" stop-opacity="0.15"/>
      <stop offset="45%"  stop-color="${footerBg}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${footerBg}" stop-opacity="0.95"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#ovGrad)"/>

  <!-- Accent line top -->
  <rect x="60" y="50" width="${W - 120}" height="4" fill="${accent}" rx="2" opacity="0.7"/>

  <!-- Main text -->
  <text x="${W / 2}" y="${textY}" text-anchor="middle"
        fill="${COLOURS.warmIvory}" font-size="64" font-weight="900" class="playfair"
        letter-spacing="-1">
    ${tspans(textLines, W / 2, textY, 76, 'text-anchor="middle"')}
  </text>

  ${subtextLines.length > 0 ? `
  <!-- Subtext -->
  <text x="${W / 2}" y="${subtextY}" text-anchor="middle"
        fill="${accent}" font-size="28" font-weight="500">
    ${tspans(subtextLines, W / 2, subtextY, 36, 'text-anchor="middle"')}
  </text>` : ''}

  <!-- Accent line above footer -->
  <rect x="60" y="${H - 88}" width="${W - 120}" height="3"
        fill="${accent}" opacity="0.4" rx="2"/>

  ${footer(footerBg, COLOURS.warmIvory)}`;

  return svgWrap(content, footerBg);
}


// ─────────────────────────────────────────────
// MAIN SWITCH — drop into existing renderCanvas()
// ─────────────────────────────────────────────
//
// Replace the existing switch(template) { ... } block
// (or add these cases to it) in your canvas Worker.
//
// async function renderCanvas(template, data, env) {
//   switch (template) {
//     // ... existing cases ...
//
//     case 'myth-vs-fact-teal':
//       return renderMythVsFact({ ...data, variant: 'teal' });
//     case 'myth-vs-fact-ivory':
//       return renderMythVsFact({ ...data, variant: 'ivory' });
//
//     case 'data-infographic':
//       return renderDataInfographic(data);
//
//     case 'awareness-day':
//       return renderAwarenessDay({ ...data, variant: 'teal' });
//     case 'awareness-day-rose':
//       return renderAwarenessDay({ ...data, variant: 'rose' });
//
//     case 'news-reaction':
//       return renderNewsReaction(data);
//
//     case 'service-explainer':
//       return renderServiceExplainer(data);
//
//     case 'semantic-teal':
//       return renderSemanticImage({ ...data, variant: 'teal' });
//     case 'semantic-rose':
//       return renderSemanticImage({ ...data, variant: 'rose' });
//     case 'semantic-dark':
//       return renderSemanticImage({ ...data, variant: 'dark' });
//
//     default:
//       throw new Error(`Unknown template: ${template}`);
//   }
// }

export {
  renderMythVsFact,
  renderDataInfographic,
  renderAwarenessDay,
  renderNewsReaction,
  renderServiceExplainer,
  renderSemanticImage,
};