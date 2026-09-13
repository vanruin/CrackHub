const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const { URL } = require('url');
const QRCode = require('qrcode');            // ⬅️ NEW

const API_URL = "https://ios.prod.ftl.netflix.com/iosui/user/15.48";

const QUERY_PARAMS = {
  appVersion: "15.48.1",
  config: '{"gamesInTrailersEnabled":"false","isTrailersEvidenceEnabled":"false","cdsMyListSortEnabled":"true","kidsBillboardEnabled":"true","addHorizontalBoxArtToVideoSummariesEnabled":"false","skOverlayTestEnabled":"false","homeFeedTestTVMovieListsEnabled":"false","baselineOnIpadEnabled":"true","trailersVideoIdLoggingFixEnabled":"true","postPlayPreviewsEnabled":"false","bypassContextualAssetsEnabled":"false","roarEnabled":"false","useSeason1AltLabelEnabled":"false","disableCDSSearchPaginationSectionKinds":["searchVideoCarousel"],"cdsSearchHorizontalPaginationEnabled":"true","searchPreQueryGamesEnabled":"true","kidsMyListEnabled":"true","billboardEnabled":"true","useCDSGalleryEnabled":"true","contentWarningEnabled":"true","videosInPopularGamesEnabled":"true","avifFormatEnabled":"false","sharksEnabled":"true"}',
  device_type: "NFAPPL-02-",
  esn: "NFAPPL-02-IPHONE8%3D1-PXA-02026U9VV5O8AUKEAEO8PUJETCGDD4PQRI9DEB3MDLEMD0EACM4CS78LMD334MN3MQ3NMJ8SU9O9MVGS6BJCURM1PH1MUTGDPF4S4200",
  idiom: "phone",
  iosVersion: "15.8.5",
  isTablet: "false",
  languages: "en-US",
  locale: "en-US",
  maxDeviceWidth: "375",
  model: "saget",
  modelType: "IPHONE8-1",
  odpAware: "true",
  path: '["account","token","default"]',
  pathFormat: "graph",
  pixelDensity: "2.0",
  progressive: "false",
  responseFormat: "json",
};

const BASE_HEADERS = {
  "User-Agent": "Argo/15.48.1 (iPhone; iOS 15.8.5; Scale/2.00)",
  "x-netflix.request.attempt": "1",
  "x-netflix.request.client.user.guid": "A4CS633D7VCBPE2GPK2HL4EKOE",
  "x-netflix.context.profile-guid": "A4CS633D7VCBPE2GPK2HL4EKOE",
  "x-netflix.request.routing": '{"path":"/nq/mobile/nqios/~15.48.0/user","control_tag":"iosui_argo"}',
  "x-netflix.context.app-version": "15.48.1",
  "x-netflix.argo.translated": "true",
  "x-netflix.context.form-factor": "phone",
  "x-netflix.context.sdk-version": "2012.4",
  "x-netflix.client.appversion": "15.48.1",
  "x-netflix.context.max-device-width": "375",
  "x-netflix.context.ab-tests": "",
  "x-netflix.tracing.cl.useractionid": "4DC655F2-9C3C-4343-8229-CA1B003C3053",
  "x-netflix.client.type": "argo",
  "x-netflix.client.ftl.esn": "NFAPPL-02-IPHONE8=1-PXA-02026U9VV5O8AUKEAEO8PUJETCGDD4PQRI9DEB3MDLEMD0EACM4CS78LMD334MN3MQ3NMJ8SU9O9MVGS6BJCURM1PH1MUTGDPF4S4200",
  "x-netflix.context.locales": "en-US",
  "x-netflix.context.top-level-uuid": "90AFE39F-ADF1-4D8A-B33E-528730990FE3",
  "x-netflix.client.iosversion": "15.8.5",
  "accept-language": "en-US;q=1",
  "x-netflix.argo.abtests": "",
  "x-netflix.context.os-version": "15.8.5",
  "x-netflix.request.client.context": '{"appState":"foreground"}',
  "x-netflix.context.ui-flavor": "argo",
  "x-netflix.argo.nfnsm": "9",
  "x-netflix.context.pixel-density": "2.0",
  "x-netflix.request.toplevel.uuid": "90AFE39F-ADF1-4D8A-B33E-528730990FE3",
  "x-netflix.request.client.timezoneid": "Asia/Dhaka",
};

function makeRequest(url, options) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 10000,
    };

    const req = https.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (data.trim().startsWith('<')) {
          reject(new Error('Netflix API is currently unavailable'));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid API response'));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

// ⬅️ NEW: QR code helpers
async function generateQRCodeDataURL(text, options = {}) {
  const defaultOptions = {
    errorCorrectionLevel: 'H',
    type: 'image/png',
    quality: 0.95,
    margin: 2,
    width: 400,
    color: { dark: '#000000', light: '#FFFFFF' },
  };
  return await QRCode.toDataURL(text, { ...defaultOptions, ...options });
}

async function generateQRCodeFile(text, outputPath, options = {}) {
  const defaultOptions = {
    errorCorrectionLevel: 'H',
    type: 'png',
    quality: 0.95,
    margin: 2,
    width: 400,
    color: { dark: '#000000', light: '#FFFFFF' },
  };
  await QRCode.toFile(outputPath, text, { ...defaultOptions, ...options });
  return outputPath;
}

async function readAccountsFromJson() {
  const possiblePaths = [
    path.join(__dirname, '..', 'public', 'Acccounts', 'nft.json'),
    path.join(process.cwd(), 'public', 'Acccounts', 'nft.json'),
    path.join(process.cwd(), 'nft.json'),
  ];

  let fileContent = null;
  let foundPath = null;

  for (const testPath of possiblePaths) {
    try {
      await fs.access(testPath);
      fileContent = await fs.readFile(testPath, 'utf-8');
      foundPath = testPath;
      break;
    } catch (err) { continue; }
  }

  if (!fileContent) throw new Error('nft.json not found in any expected location');

  console.log(`✅ Found nft.json at: ${foundPath}`);

  let data;
  try { data = JSON.parse(fileContent); }
  catch (e) { throw new Error('nft.json is not valid JSON'); }

  if (!Array.isArray(data)) throw new Error('nft.json must be an array');

  const accounts = data.filter(a => a && a.cookie);
  console.log(`📚 Loaded ${accounts.length} Netflix accounts from nft.json`);

  if (accounts.length === 0) throw new Error('No valid accounts in nft.json');
  return accounts;
}

async function getNetflixAccountCount() {
  try {
    const accounts = await readAccountsFromJson();
    return accounts.length;
  } catch (error) { return 0; }
}

function parseCookies(cookieString) {
  const cookies = { NetflixId: null, SecureNetflixId: null, nfvdid: null };
  const parts = cookieString.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith('NetflixId=')) {
      cookies.NetflixId = trimmed.slice('NetflixId='.length);
    } else if (trimmed.startsWith('SecureNetflixId=')) {
      cookies.SecureNetflixId = trimmed.slice('SecureNetflixId='.length);
    } else if (trimmed.startsWith('nfvdid=')) {
      cookies.nfvdid = trimmed.slice('nfvdid='.length);
    }
  }
  return cookies;
}

async function testCookie(netflixId, secureNetflixId = null, nfvdid = null) {
  const headers = { ...BASE_HEADERS };
  let cookieString = `NetflixId=${netflixId}`;
  if (secureNetflixId) cookieString += `; SecureNetflixId=${secureNetflixId}`;
  if (nfvdid) cookieString += `; nfvdid=${nfvdid}`;
  headers.Cookie = cookieString;

  const url = `${API_URL}?${new URLSearchParams(QUERY_PARAMS).toString()}`;
  const response = await makeRequest(url, { method: 'GET', headers });

  const tokenData = response?.value?.account?.token?.default || {};
  const token = tokenData.token;
  const expires = tokenData.expires;

  if (!token) throw new Error('No token found in response');

  const currentTime = Date.now();
  const isExpired = expires && currentTime > expires;

  return {
    success: true,
    token,
    expires,
    isExpired,
    loginUrl: `https://netflix.com/login?nftoken=${token}`,
  };
}

async function getRandomNetflixCookie(selectionMethod = 'smart', qrOptions = {}) {
  const {
    generateQR = true,
    saveQRFile = false,
    qrOutputPath = path.join(process.cwd(), 'netflix-qr.png'),
  } = qrOptions;

  const accounts = await readAccountsFromJson();
  if (accounts.length === 0) throw new Error('No accounts found in nft.json');

  const accountsToTest = [...accounts];
  for (let i = accountsToTest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [accountsToTest[i], accountsToTest[j]] = [accountsToTest[j], accountsToTest[i]];
  }

  console.log(`🎲 Using ${selectionMethod.toUpperCase()} selection`);

  let attempts = 0;
  let lastError = null;

  for (const account of accountsToTest) {
    attempts++;
    const cookies = parseCookies(account.cookie);

    if (!cookies.NetflixId) {
      console.log(`❌ Attempt ${attempts}: No NetflixId in cookie`);
      continue;
    }

    try {
      console.log(`🎬 Attempt ${attempts}/${accountsToTest.length}: Testing account...`);
      const result = await testCookie(cookies.NetflixId, cookies.SecureNetflixId, cookies.nfvdid);

      if (!result.isExpired && result.token) {
        console.log(`✅ Working Netflix account found!`);

        // ⬅️ NEW: QR generation
        let qrCodeData = null;
        let qrCodeFilePath = null;

        if (generateQR) {
          try {
            console.log(`📱 Generating QR code...`);
            qrCodeData = await generateQRCodeDataURL(result.loginUrl);
            console.log(`✅ QR generated (${qrCodeData.length} chars)`);

            if (saveQRFile) {
              qrCodeFilePath = await generateQRCodeFile(result.loginUrl, qrOutputPath);
              console.log(`✅ QR file saved: ${qrCodeFilePath}`);
            }
          } catch (qrError) {
            console.log(`⚠️ QR generation failed: ${qrError.message}`);
          }
        }

        return {
          success: true,
          attempts: attempts,
          totalAccounts: accounts.length,
          selectionMethod: selectionMethod,
          data: {
            email: account.email || null,
            password: account.password || null,
            country: account.country || null,
            maxStreams: account.MaxStreams || null,
            since: account.Since || null,
            phone: account.phone || null,
            loginUrl: result.loginUrl,
            token: result.token,
            expires: result.expires ? new Date(result.expires).toLocaleString() : 'Unknown',
            qrCode: qrCodeData,             // ⬅️ NEW
            qrCodeFilePath: qrCodeFilePath, // ⬅️ NEW
          },
        };
      } else {
        console.log(`⚠️ Attempt ${attempts}: Cookie expired`);
        lastError = 'Cookie expired';
      }
    } catch (error) {
      console.log(`❌ Attempt ${attempts}: ${error.message}`);
      lastError = error.message;
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`No working Netflix cookies found. Tested ${attempts} accounts. Last error: ${lastError}`);
}

module.exports = {
  getRandomNetflixCookie,
  getNetflixAccountCount,
  generateQRCodeDataURL,   // ⬅️ NEW
  generateQRCodeFile,      // ⬅️ NEW
};