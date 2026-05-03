const fs = require('fs').promises;
const path = require('path');

// Path to xbox accounts file
const XBOX_ACCOUNTS_PATH = path.join(__dirname, '..', 'public', 'Acccounts', 'xbox.txt');

// Cache for accounts
let cachedAccounts = null;
let lastLoaded = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Read and parse xbox.txt file
 * Format: email:pass
 */
async function loadXboxAccounts() {
    // Check cache
    if (cachedAccounts && lastLoaded && (Date.now() - lastLoaded) < CACHE_DURATION) {
        return cachedAccounts;
    }
    
    try {
        // Check if file exists
        try {
            await fs.access(XBOX_ACCOUNTS_PATH);
        } catch (err) {
            console.error(`❌ xbox.txt not found at: ${XBOX_ACCOUNTS_PATH}`);
            return [];
        }
        
        // Read file
        const data = await fs.readFile(XBOX_ACCOUNTS_PATH, 'utf-8');
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
        
        console.log(`📚 Loaded ${accounts.length} Xbox accounts from xbox.txt`);
        return accounts;
    } catch (error) {
        console.error('❌ Error loading xbox.txt:', error.message);
        return [];
    }
}

/**
 * Get random Xbox account
 */
async function getRandomXboxAccount() {
    const accounts = await loadXboxAccounts();
    
    if (accounts.length === 0) {
        throw new Error('No Xbox accounts found in xbox.txt. Please add accounts in format: email:pass');
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
async function getXboxAccountCount() {
    const accounts = await loadXboxAccounts();
    return accounts.length;
}

/**
 * Add new Xbox account
 */
async function addXboxAccount(email, password) {
    const accounts = await loadXboxAccounts();
    
    // Check if account already exists
    const exists = accounts.some(acc => acc.email === email);
    if (exists) {
        throw new Error('Account already exists');
    }
    
    // Append to file
    const newLine = `${email}:${password}\n`;
    await fs.appendFile(XBOX_ACCOUNTS_PATH, newLine, 'utf-8');
    
    // Clear cache
    cachedAccounts = null;
    
    return { success: true, message: 'Account added successfully' };
}

module.exports = {
    getRandomXboxAccount,
    getXboxAccountCount,
    addXboxAccount
};