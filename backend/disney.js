const fs = require('fs').promises;
const path = require('path');

// Path to disney accounts file
const DISNEY_ACCOUNTS_PATH = path.join(__dirname, '..', 'public', 'Acccounts', 'disney.txt');

// Cache for accounts
let cachedAccounts = null;
let lastLoaded = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Read and parse disney.txt file
 * Format: email:pass
 */
async function loadDisneyAccounts() {
    // Check cache
    if (cachedAccounts && lastLoaded && (Date.now() - lastLoaded) < CACHE_DURATION) {
        return cachedAccounts;
    }
    
    try {
        // Check if file exists
        try {
            await fs.access(DISNEY_ACCOUNTS_PATH);
        } catch (err) {
            console.error(`❌ disney.txt not found at: ${DISNEY_ACCOUNTS_PATH}`);
            return [];
        }
        
        // Read file
        const data = await fs.readFile(DISNEY_ACCOUNTS_PATH, 'utf-8');
        const lines = data.split('\n').filter(line => line.trim() && line.includes(':'));
        
        const accounts = lines.map(line => {
            // Remove any extra metadata after password (like | Country = US, etc.)
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
        
        console.log(`📚 Loaded ${accounts.length} Disney+ accounts from disney.txt`);
        return accounts;
    } catch (error) {
        console.error('❌ Error loading disney.txt:', error.message);
        return [];
    }
}

/**
 * Get random Disney+ account
 */
async function getRandomDisneyAccount() {
    const accounts = await loadDisneyAccounts();
    
    if (accounts.length === 0) {
        throw new Error('No Disney+ accounts found in disney.txt. Please add accounts in format: email:pass');
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
async function getDisneyAccountCount() {
    const accounts = await loadDisneyAccounts();
    return accounts.length;
}

/**
 * Add new Disney+ account
 */
async function addDisneyAccount(email, password) {
    const accounts = await loadDisneyAccounts();
    
    // Check if account already exists
    const exists = accounts.some(acc => acc.email === email);
    if (exists) {
        throw new Error('Account already exists');
    }
    
    // Append to file
    const newLine = `${email}:${password}\n`;
    await fs.appendFile(DISNEY_ACCOUNTS_PATH, newLine, 'utf-8');
    
    // Clear cache
    cachedAccounts = null;
    
    return { success: true, message: 'Account added successfully' };
}

module.exports = {
    getRandomDisneyAccount,
    getDisneyAccountCount,
    addDisneyAccount
};