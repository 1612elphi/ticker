// Claude logo as a 1-bit bitmap for receipt printing
// Simple stylized "C" sparkle mark, 80x80px, hand-drawn in code

import sharp from 'sharp';

// Generate the Claude logo as a PNG buffer
export async function generateLogo(): Promise<Buffer> {
  // Create the Anthropic sparkle/asterisk mark as SVG
  // Based on the Claude logo — a rounded asterisk/sparkle shape
  const svg = `<svg width="120" height="120" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
    <rect width="120" height="120" fill="white"/>
    <g transform="translate(60,60)">
      <!-- Claude sparkle/asterisk shape -->
      <path d="
        M 0,-45
        C 5,-20 10,-15 15,-10
        C 20,-5 40,-5 45,0
        C 40,5 20,5 15,10
        C 10,15 5,20 0,45
        C -5,20 -10,15 -15,10
        C -20,5 -40,5 -45,0
        C -40,-5 -20,-5 -15,-10
        C -10,-15 -5,-20 0,-45
        Z
      " fill="black"/>
    </g>
  </svg>`;

  return Buffer.from(svg);
}

export async function getLogoPng(): Promise<Buffer> {
  const svg = await generateLogo();
  return sharp(svg)
    .resize(160, 160, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer();
}
