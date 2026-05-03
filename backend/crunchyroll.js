const fs = require('fs').promises;
const path = require('path');

// Path to crunchyroll accounts file
const CRUNCHYROLL_ACCOUNTS_PATH = path.join(__dirname, '..', 'public', 'Acccounts', 'crunchyroll.txt');

// Cache for valid accounts
let cachedAccounts = null;
let lastLoaded = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Read and parse crunchyroll.txt file
 * Format: email:pass
 */
async function loadCrunchyrollAccounts() {
    // Check cache
    if (cachedAccounts && lastLoaded && (Date.now() - lastLoaded) < CACHE_DURATION) {
        return cachedAccounts;
    }
    
    try {
        // Check if file exists
        try {
            await fs.access(CRUNCHYROLL_ACCOUNTS_PATH);
        } catch (err) {
            console.error(`❌ crunchyroll.txt not found at: ${CRUNCHYROLL_ACCOUNTS_PATH}`);
            return [];
        }
        
        // Read file
        const data = await fs.readFile(CRUNCHYROLL_ACCOUNTS_PATH, 'utf-8');
        const lines = data.split('\n').filter(line => line.trim() && line.includes(':'));
        
        const accounts = lines.map(line => {
            const [email, password] = line.split(':');
            return {
                email: email.trim(),
                password: password.trim(),
                original: line.trim()
            };
        });
        
        cachedAccounts = accounts;
        lastLoaded = Date.now();
        
        console.log(`📚 Loaded ${accounts.length} Crunchyroll accounts from crunchyroll.txt`);
        return accounts;
    } catch (error) {
        console.error('❌ Error loading crunchyroll.txt:', error.message);
        return [];
    }
}

/**
 * Get random Crunchyroll account
 */
async function getRandomCrunchyrollAccount() {
    const accounts = await loadCrunchyrollAccounts();
    
    if (accounts.length === 0) {
        throw new Error('No Crunchyroll accounts found in crunchyroll.txt. Please add accounts in format: email:pass');
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
async function getCrunchyrollAccountCount() {
    const accounts = await loadCrunchyrollAccounts();
    return accounts.length;
}

/**
 * Add new Crunchyroll account
 */
async function addCrunchyrollAccount(email, password) {
    const accounts = await loadCrunchyrollAccounts();
    
    // Check if account already exists
    const exists = accounts.some(acc => acc.email === email);
    if (exists) {
        throw new Error('Account already exists');
    }
    
    // Append to file
    const newLine = `${email}:${password}\n`;
    await fs.appendFile(CRUNCHYROLL_ACCOUNTS_PATH, newLine, 'utf-8');
    
    // Clear cache
    cachedAccounts = null;
    
    return { success: true, message: 'Account added successfully' };
}

module.exports = {
    getRandomCrunchyrollAccount,
    getCrunchyrollAccountCount,
    addCrunchyrollAccount
};