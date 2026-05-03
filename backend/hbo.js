const fs = require('fs').promises;
const path = require('path');

// Path to HBO cookies file
const HBO_COOKIES_PATH = path.join(__dirname, '..', 'public', 'Acccounts', 'hbo.txt');

// Cache for cookies
let cachedCookies = null;
let lastLoaded = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Parse Netscape cookie file format (TAB-separated)
 * Format: domain\tflag\tpath\tsecure\texpiration\tname\tvalue
 */
function parseNetscapeCookie(line) {
    const parts = line.split('\t');
    if (parts.length >= 7) {
        return {
            name: parts[5].trim(),
            value: parts[6].trim(),
            domain: parts[0].trim(),
            flag: parts[1].trim(),
            path: parts[2].trim(),
            secure: parts[3].trim() === 'TRUE',
            expiration: parts[4].trim()
        };
    }
    return null;
}

/**
 * Parse semicolon format: name=value; name2=value2
 */
function parseSemicolonFormat(line) {
    const cookies = [];
    // Remove leading/trailing spaces and semicolons
    const cleanLine = line.replace(/^;\s*/, '').replace(/\s*$/, '');
    const pairs = cleanLine.split(';');
    
    for (const pair of pairs) {
        const equalIndex = pair.indexOf('=');
        if (equalIndex > 0) {
            const name = pair.substring(0, equalIndex).trim();
            const value = pair.substring(equalIndex + 1).trim();
            if (name && value) {
                cookies.push({
                    name: name,
                    value: value,
                    domain: '.hbomax.com',
                    path: '/',
                    secure: true,
                    flag: 'TRUE',
                    expiration: Math.floor(Date.now() / 1000) + 31536000 // 1 year
                });
            }
        }
    }
    return cookies;
}

/**
 * Convert cookie object to Netscape format line
 */
function toNetscapeFormat(cookie) {
    const domain = cookie.domain || '.hbomax.com';
    const flag = cookie.flag === 'TRUE' || cookie.secure === true ? 'TRUE' : 'FALSE';
    const path = cookie.path || '/';
    const secure = cookie.secure === true || cookie.secure === 'TRUE' ? 'TRUE' : 'FALSE';
    const expiration = cookie.expiration || Math.floor(Date.now() / 1000) + 31536000;
    const name = cookie.name;
    const value = cookie.value;
    
    return `${domain}\t${flag}\t${path}\t${secure}\t${expiration}\t${name}\t${value}`;
}

/**
 * Read and parse hbo.txt file (supports multiple formats)
 */
async function loadHboCookies() {
    // Check cache
    if (cachedCookies && lastLoaded && (Date.now() - lastLoaded) < CACHE_DURATION) {
        return cachedCookies;
    }
    
    try {
        // Check if file exists
        try {
            await fs.access(HBO_COOKIES_PATH);
        } catch (err) {
            console.error(`❌ hbo.txt not found at: ${HBO_COOKIES_PATH}`);
            return [];
        }
        
        // Read file
        const data = await fs.readFile(HBO_COOKIES_PATH, 'utf-8');
        
        // Split by cookie blocks (separated by ========)
        const cookieBlocks = data.split(/={3,}/);
        const validCookies = [];
        
        for (const block of cookieBlocks) {
            if (!block.trim()) continue;
            
            const lines = block.split('\n');
            let currentCookieSet = [];
            let semicolonBuffer = '';
            let isNetscapeBlock = false;
            
            for (let line of lines) {
                line = line.trim();
                
                // Skip empty lines and comments
                if (!line || line.startsWith('#')) continue;
                
                // Check if it's TAB-separated Netscape format
                if (line.includes('\t') && line.split('\t').length >= 7) {
                    isNetscapeBlock = true;
                    // Parse any buffered semicolon format first
                    if (semicolonBuffer) {
                        const semicolonCookies = parseSemicolonFormat(semicolonBuffer);
                        currentCookieSet.push(...semicolonCookies);
                        semicolonBuffer = '';
                    }
                    
                    const cookie = parseNetscapeCookie(line);
                    if (cookie) {
                        currentCookieSet.push(cookie);
                    }
                }
                // Check if it's semicolon format (st=xxx; usr_state=xxx)
                else if (line.includes('=') && (line.includes(';') || line.startsWith('st=') || line.includes('usr_'))) {
                    semicolonBuffer += line + ' ';
                }
                // Check for standalone cookie lines (name=value without semicolon)
                else if (line.includes('=') && !line.includes(';') && line.split('=').length === 2) {
                    const [name, value] = line.split('=');
                    if (name && value) {
                        currentCookieSet.push({
                            name: name.trim(),
                            value: value.trim(),
                            domain: '.hbomax.com',
                            path: '/',
                            secure: true,
                            flag: 'TRUE',
                            expiration: Math.floor(Date.now() / 1000) + 31536000
                        });
                    }
                }
            }
            
            // Parse any remaining semicolon buffer
            if (semicolonBuffer) {
                const semicolonCookies = parseSemicolonFormat(semicolonBuffer);
                currentCookieSet.push(...semicolonCookies);
            }
            
            if (currentCookieSet.length > 0) {
                validCookies.push({
                    cookies: currentCookieSet,
                    raw: block.trim(),
                    isNetscape: isNetscapeBlock
                });
            }
        }
        
        cachedCookies = validCookies;
        lastLoaded = Date.now();
        
        console.log(`📚 Loaded ${validCookies.length} HBO cookie sets from hbo.txt`);
        validCookies.forEach((set, i) => {
            console.log(`   Set ${i + 1}: ${set.cookies.length} cookies`);
        });
        return validCookies;
    } catch (error) {
        console.error('❌ Error loading hbo.txt:', error.message);
        return [];
    }
}

/**
 * Get random HBO cookie set
 */
async function getRandomHboCookie() {
    const cookieSets = await loadHboCookies();
    
    if (cookieSets.length === 0) {
        throw new Error('No HBO cookies found in hbo.txt. Please add cookies in Netscape or semicolon format.');
    }
    
    const randomIndex = Math.floor(Math.random() * cookieSets.length);
    const cookieSet = cookieSets[randomIndex];
    
    // Convert cookies to string format for browser extensions
    let cookieString = '';
    for (const cookie of cookieSet.cookies) {
        cookieString += `${cookie.name}=${cookie.value}; `;
    }
    
    // Create Netscape format string for download
    let netscapeContent = '# Netscape HTTP Cookie File\n';
    netscapeContent += '# https://curl.se/docs/http-cookies.html\n';
    netscapeContent += `# Generated: ${new Date().toISOString()}\n\n`;
    
    for (const cookie of cookieSet.cookies) {
        netscapeContent += toNetscapeFormat(cookie) + '\n';
    }
    
    // Create JSON format for Cookie-Editor extension
    const cookieJson = cookieSet.cookies.map(cookie => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain || '.hbomax.com',
        path: cookie.path || '/',
        secure: cookie.secure === true || cookie.secure === 'TRUE',
        httpOnly: false,
        sameSite: 'lax'
    }));
    
    return {
        success: true,
        data: {
            cookies: cookieSet.cookies,
            cookieString: cookieString,
            cookieJson: cookieJson,
            netscapeFormat: netscapeContent,
            cookieCount: cookieSet.cookies.length,
            raw: cookieSet.raw
        },
        cookiesRemaining: cookieSets.length,
        timestamp: new Date().toISOString()
    };
}

/**
 * Get total cookie count
 */
async function getHboCookieCount() {
    const cookieSets = await loadHboCookies();
    return cookieSets.length;
}

module.exports = {
    getRandomHboCookie,
    getHboCookieCount,
    toNetscapeFormat
};