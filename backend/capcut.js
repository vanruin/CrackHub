const fs = require('fs').promises;
const path = require('path');

// Path to capcut accounts file
const CAPCUT_ACCOUNTS_PATH = path.join(__dirname, '..', 'public', 'Acccounts', 'capcut.txt');

// Cache for accounts
let cachedAccounts = null;
let lastLoaded = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Read and parse capcut.txt file
 * Format: email:pass
 */
async function loadCapcutAccounts() {
    // Check cache
    if (cachedAccounts && lastLoaded && (Date.now() - lastLoaded) < CACHE_DURATION) {
        return cachedAccounts;
    }
    
    try {
        // Check if file exists
        try {
            await fs.access(CAPCUT_ACCOUNTS_PATH);
        } catch (err) {
            console.error(`❌ capcut.txt not found at: ${CAPCUT_ACCOUNTS_PATH}`);
            return [];
        }
        
        // Read file
        const data = await fs.readFile(CAPCUT_ACCOUNTS_PATH, 'utf-8');
        const lines = data.split('\n').filter(line => line.trim() && line.includes(':'));
        
        const accounts = lines.map(line => {
            // Remove any extra metadata after password
            let cleanLine = line.split('|')[0].trim();
            const [email, password] = cleanLine.split(':');
            return {
                email: email.trim(),
                password: password.trim(),
                original: line.trim()
            };
        });
        
        cachedAccounts = accounts;
        lastLoaded = Date.now();
        
        console.log(`📚 Loaded ${accounts.length} CapCut accounts from capcut.txt`);
        return accounts;
    } catch (error) {
        console.error('❌ Error loading capcut.txt:', error.message);
        return [];
    }
}

/**
 * Get random CapCut account
 */
async function getRandomCapcutAccount() {
    const accounts = await loadCapcutAccounts();
    
    if (accounts.length === 0) {
        throw new Error('No CapCut accounts found in capcut.txt. Please add accounts in format: email:pass');
    }
    
    const randomIndex = Math.floor(Math.random() * accounts.length);
    const account = accounts[randomIndex];
    
    return {
        success: true,
        data: {
            email: account.email,
            password: account.password
        },
        accountsRemaining: accounts.length,
        timestamp: new Date().toISOString()
    };
}

/**
 * Get total account count
 */
async function getCapcutAccountCount() {
    const accounts = await loadCapcutAccounts();
    return accounts.length;
}

/**
 * Add new CapCut account
 */
async function addCapcutAccount(email, password) {
    const accounts = await loadCapcutAccounts();
    
    // Check if account already exists
    const exists = accounts.some(acc => acc.email === email);
    if (exists) {
        throw new Error('Account already exists');
    }
    
    // Append to file
    const newLine = `${email}:${password}\n`;
    await fs.appendFile(CAPCUT_ACCOUNTS_PATH, newLine, 'utf-8');
    
    // Clear cache
    cachedAccounts = null;
    
    return { success: true, message: 'Account added successfully' };
}

module.exports = {
    getRandomCapcutAccount,
    getCapcutAccountCount,
    addCapcutAccount
};