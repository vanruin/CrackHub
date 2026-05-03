const fs = require('fs').promises;
const path = require('path');

const PARAMOUNT_ACCOUNTS_PATH = path.join(__dirname, '..', 'public', 'Acccounts', 'paramount.txt');

let cachedAccounts = null;
let lastLoaded = null;
const CACHE_DURATION = 5 * 60 * 1000;

async function loadParamountAccounts() {
    if (cachedAccounts && lastLoaded && (Date.now() - lastLoaded) < CACHE_DURATION) {
        return cachedAccounts;
    }
    
    try {
        await fs.access(PARAMOUNT_ACCOUNTS_PATH);
        const data = await fs.readFile(PARAMOUNT_ACCOUNTS_PATH, 'utf-8');
        const lines = data.split('\n').filter(line => line.trim() && line.includes(':'));
        
        const accounts = lines.map(line => {
            let cleanLine = line.split('|')[0].trim();
            const [email, password] = cleanLine.split(':');
            return {
                email: email.trim(),
                password: password.trim()
            };
        });
        
        cachedAccounts = accounts;
        lastLoaded = Date.now();
        
        console.log(`📚 Loaded ${accounts.length} Paramount+ accounts`);
        return accounts;
    } catch (error) {
        console.error('❌ Error loading paramount.txt:', error.message);
        return [];
    }
}

async function getRandomParamountAccount() {
    const accounts = await loadParamountAccounts();
    
    if (accounts.length === 0) {
        throw new Error('No Paramount+ accounts found in paramount.txt');
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

async function getParamountAccountCount() {
    const accounts = await loadParamountAccounts();
    return accounts.length;
}

module.exports = {
    getRandomParamountAccount,
    getParamountAccountCount
};