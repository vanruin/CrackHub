const fs = require('fs').promises;
const path = require('path');

// Path to moonton accounts file
const MOONTON_ACCOUNTS_PATH = path.join(__dirname, '..', 'public', 'Acccounts', 'moonton.txt');

// Cache for accounts
let cachedAccounts = null;
let lastLoaded = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Clean account data by removing channel and configs info
 */
function cleanAccountData(line) {
    // Remove everything after "Channel :" or "Configs :"
    let cleanLine = line.split('Channel :')[0].trim();
    cleanLine = cleanLine.split('Configs :')[0].trim();
    
    // Extract email and password from the beginning
    const emailMatch = cleanLine.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}:[^\s|]+)/);
    
    if (emailMatch) {
        const [email, password] = emailMatch[1].split(':');
        // Extract additional info (everything after the password)
        const restOfLine = cleanLine.substring(cleanLine.indexOf(emailMatch[1]) + emailMatch[1].length);
        
        return {
            email: email.trim(),
            password: password.trim(),
            extraInfo: restOfLine.trim()
        };
    }
    
    // Fallback: try to split by first colon for email, second for password
    const parts = cleanLine.split('|');
    const firstPart = parts[0].trim();
    if (firstPart.includes(':')) {
        const colonIndex = firstPart.indexOf(':');
        const email = firstPart.substring(0, colonIndex).trim();
        let password = firstPart.substring(colonIndex + 1).trim();
        
        // Clean password from any extra spaces
        password = password.split(' ')[0];
        
        return {
            email: email,
            password: password,
            extraInfo: parts.slice(1).join(' | ').trim()
        };
    }
    
    return null;
}

/**
 * Read and parse moonton.txt file
 * Format: email:pass | Level | Name | Country | Rank | UID | Registered
 */
async function loadMoontonAccounts() {
    // Check cache
    if (cachedAccounts && lastLoaded && (Date.now() - lastLoaded) < CACHE_DURATION) {
        return cachedAccounts;
    }
    
    try {
        // Check if file exists
        try {
            await fs.access(MOONTON_ACCOUNTS_PATH);
        } catch (err) {
            console.error(`❌ moonton.txt not found at: ${MOONTON_ACCOUNTS_PATH}`);
            return [];
        }
        
        // Read file
        const data = await fs.readFile(MOONTON_ACCOUNTS_PATH, 'utf-8');
        const lines = data.split('\n').filter(line => line.trim());
        
        const accounts = [];
        
        for (const line of lines) {
            if (!line.trim()) continue;
            
            const cleaned = cleanAccountData(line);
            if (cleaned && cleaned.email && cleaned.password) {
                accounts.push({
                    email: cleaned.email,
                    password: cleaned.password,
                    extraInfo: cleaned.extraInfo || '',
                    original: line.trim()
                });
            }
        }
        
        cachedAccounts = accounts;
        lastLoaded = Date.now();
        
        console.log(`📚 Loaded ${accounts.length} Moonton accounts from moonton.txt`);
        return accounts;
    } catch (error) {
        console.error('❌ Error loading moonton.txt:', error.message);
        return [];
    }
}

/**
 * Get random Moonton account
 */
async function getRandomMoontonAccount() {
    const accounts = await loadMoontonAccounts();
    
    if (accounts.length === 0) {
        throw new Error('No Moonton accounts found in moonton.txt');
    }
    
    const randomIndex = Math.floor(Math.random() * accounts.length);
    const account = accounts[randomIndex];
    
    return {
        success: true,
        data: {
            email: account.email,
            password: account.password,
            extraInfo: account.extraInfo
        },
        accountsRemaining: accounts.length,
        timestamp: new Date().toISOString()
    };
}

/**
 * Get total account count
 */
async function getMoontonAccountCount() {
    const accounts = await loadMoontonAccounts();
    return accounts.length;
}

/**
 * Add new Moonton account
 */
async function addMoontonAccount(email, password, extraInfo = '') {
    const accounts = await loadMoontonAccounts();
    
    // Check if account already exists
    const exists = accounts.some(acc => acc.email === email);
    if (exists) {
        throw new Error('Account already exists');
    }
    
    // Append to file
    const newLine = `${email}:${password} ${extraInfo}\n`;
    await fs.appendFile(MOONTON_ACCOUNTS_PATH, newLine, 'utf-8');
    
    // Clear cache
    cachedAccounts = null;
    
    return { success: true, message: 'Account added successfully' };
}

module.exports = {
    getRandomMoontonAccount,
    getMoontonAccountCount,
    addMoontonAccount
};