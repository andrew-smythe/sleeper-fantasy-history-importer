const db = require('./lib/db.js');
const sleeper = require('./lib/sleeper.js');
const fs = require('fs');

async function main() {

    // Load settings
    try {
        let settings = JSON.parse(fs.readFileSync('settings.json'));

        const mysql = db.makeDb(settings.db.host, settings.db.user, settings.db.password, settings.db.database);
        
        // Test connection
        await mysql.query('SELECT 1 + 1 AS test');
        console.log('Connected to database');

        await sleeper.updatePlayers(mysql);
        await sleeper.importMatchups(mysql, settings.leagueIds);
        await sleeper.importTrades(mysql, settings.leagueIds);
        await sleeper.importDrafts(mysql, settings.leagueIds);

        await mysql.close();
        console.log('Connection to DB closed.');
    }
    catch (e) {
        console.error('ERROR - Could not read settings from settings.json');
        console.error(e);
    }
}

main();