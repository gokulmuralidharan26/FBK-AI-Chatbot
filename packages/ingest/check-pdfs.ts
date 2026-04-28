import pdfParse from 'pdf-parse/lib/pdf-parse.js';

// The recent PDFs that succeeded (links 25, 27, 29, 30, 31, 32, 33, 34, 35, 36, 37)
const fileIds = [
  '1xAceUZOwjTvljIryfsMY24S4rbDX1-Nf',  // #25 Fall
  '1Ldf5_-g6PiSaVY38XJEsusMCFq-UsZar',  // #27 Fall
  '1PQMS7jZ619tZ2TANMEjk2KARXYXFdDsY',  // #29 Fall
  '1OkHXrwOeIv_jFBnMSmBuhitzXnBr-yrA',  // #30 Fall
  '1tmauIHdlFHFgFk_21ThSB3NcAhf_Ufki',  // #31 Spring
  '19V_z3zcfVlB05FyMD8pkVAJr8PuhZZzX',  // #32 Fall
  '1uFB_HUJYE0QD8ueuHz1zCaImeRZi2afw',  // #33 Spring
  '1sqkfTD24X0LnOQCmRfI-dyAm3ygscgQi',  // #34 Spring
  '10J3s8Hvp-RQZhjYs3yCQw-Bk4J0UnJU1', // #35 Fall (share_link)
  '1iaTYCqwB2GUYf5-v--tJNIHbgGRCT8um', // #36 Spring
  '1o3DQDTh0MvIC32_YcuBE4vU_O1A28UBL', // #37 Spring
];

for (const id of fileIds) {
  try {
    const res = await fetch(`https://drive.google.com/uc?export=download&id=${id}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const parsed = await pdfParse(buf);
    const text = parsed.text.toLowerCase();
    const hasGokul = text.includes('gokul');
    const firstLine = parsed.text.slice(0, 200).replace(/\n/g, ' ').trim();
    console.log(`${id.slice(0,10)}: ${hasGokul ? '★ GOKUL FOUND' : 'no gokul'} | ${firstLine}`);
  } catch (e) {
    console.log(`${id.slice(0,10)}: ERROR - ${(e as Error).message.slice(0,60)}`);
  }
}
