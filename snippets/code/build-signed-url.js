// Build a GCS V4 (GOOG4-RSA-SHA256) signed-URL "string to sign". The RSA signature is
// produced by IAM signBlob (next node), so no private key is ever stored. The only crypto
// primitive needed client-side is SHA-256 of the canonical request, vendored below so this
// works in the restricted n8n Code-node sandbox (no Node modules, no Buffer).

function sha256hex(ascii) {
  function rotr(n, x) { return (x >>> n) | (x << (32 - n)); }
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
  const bytes = [];
  for (let i = 0; i < ascii.length; i++) {
    let c = ascii.charCodeAt(i);
    if (c < 128) bytes.push(c);
    else if (c < 2048) bytes.push(192 | (c >> 6), 128 | (c & 63));
    else bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
  }
  const l = bytes.length;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);
  const bl = l * 8;
  for (let i = 7; i >= 0; i--) bytes.push((Math.floor(bl / Math.pow(2, i * 8))) & 0xff);
  const w = new Array(64);
  for (let j = 0; j < bytes.length; j += 64) {
    for (let i = 0; i < 16; i++) w[i] = (bytes[j+i*4] << 24) | (bytes[j+i*4+1] << 16) | (bytes[j+i*4+2] << 8) | (bytes[j+i*4+3]);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(7, w[i-15]) ^ rotr(18, w[i-15]) ^ (w[i-15] >>> 3);
      const s1 = rotr(17, w[i-2]) ^ rotr(19, w[i-2]) ^ (w[i-2] >>> 10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0;
    }
    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(6,e) ^ rotr(11,e) ^ rotr(25,e);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(2,a) ^ rotr(13,a) ^ rotr(22,a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
    }
    h0=(h0+a)|0; h1=(h1+b)|0; h2=(h2+c)|0; h3=(h3+d)|0; h4=(h4+e)|0; h5=(h5+f)|0; h6=(h6+g)|0; h7=(h7+h)|0;
  }
  const toHex = n => ('00000000' + ((n >>> 0).toString(16))).slice(-8);
  return [h0,h1,h2,h3,h4,h5,h6,h7].map(toHex).join('');
}

function b64(str) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 128) bytes.push(c);
    else if (c < 2048) bytes.push(192 | (c >> 6), 128 | (c & 63));
    else bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i+1], b2 = bytes[i+2];
    out += chars[b0 >> 2];
    out += chars[((b0 & 3) << 4) | ((b1 || 0) >> 4)];
    out += i + 1 < bytes.length ? chars[((b1 & 15) << 2) | ((b2 || 0) >> 6)] : '=';
    out += i + 2 < bytes.length ? chars[b2 & 63] : '=';
  }
  return out;
}

function enc(s) {
  return encodeURIComponent(s).replace(/[!*'()]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
function encPath(p) { return p.split('/').map(enc).join('/'); }
function pad(n) { return String(n).padStart(2, '0'); }

const carry = $('Build TTS request').first().json;
const sa = 'maths-vm-sa@data-concept-studio.iam.gserviceaccount.com';
const bucket = carry.bucket;
const object = carry.objectName;
const ttl = Math.min(Number(604800), 604800);
const region = 'auto';

const now = new Date();
const datestamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
const reqTs = `${datestamp}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
const scope = `${datestamp}/${region}/storage/goog4_request`;
const credential = `${sa}/${scope}`;
const host = 'storage.googleapis.com';
const canonicalUri = `/${bucket}/${encPath(object)}`;

const qsPairs = [
  ['X-Goog-Algorithm', 'GOOG4-RSA-SHA256'],
  ['X-Goog-Credential', credential],
  ['X-Goog-Date', reqTs],
  ['X-Goog-Expires', String(ttl)],
  ['X-Goog-SignedHeaders', 'host']
].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
const canonicalQuery = qsPairs.map(([k, v]) => `${k}=${v}`).join('&');

const canonicalRequest = ['GET', canonicalUri, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
const stringToSign = ['GOOG4-RSA-SHA256', reqTs, scope, sha256hex(canonicalRequest)].join('\n');

return [{
  json: {
    ...carry,
    signer: sa,
    baseUrl: `https://${host}${canonicalUri}?${canonicalQuery}`,
    payloadB64: b64(stringToSign)
  }
}];
