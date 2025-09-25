const sleeperApiUrl = "https://api.sleeper.app/v1/";

module.exports = {
    // we wouldn't want to make sleeper mad now, would we?
    sleep: function () {
        return new Promise(r => setTimeout(r, 50));
    },

    // Call Sleeper's Player API to update entire player database
    // This should only be called once a day - it will do a complete replace
    updatePlayers: async function (db) {
        
        console.log('Checking if Sleeper players table needs to be updated...');

        // check for most recent update
        let result = await db.query('SELECT lastUpdated FROM `sleeperplayers` ORDER BY lastUpdated ASC LIMIT 1');
        let diff = 100000;
        if (result.length > 0) {
            const currentDate = new Date();
            const lastUpdated = result[0].lastUpdated;
            diff = Math.floor((currentDate - lastUpdated) / 1000);
            console.log('The Sleeper Player DB was last updated ' + diff + ' seconds ago.');
        }

        if (diff >= 86400)  {
            console.log('Updating Sleeper Player DB...');
            console.log('Deleting all old players first');
            await db.query('DELETE FROM sleeperplayers');
            await db.query ('ALTER TABLE sleeperplayers AUTO_INCREMENT = 1');
            
            let playersUrl = sleeperApiUrl + "players/nfl";
            try {
                let playersFetch = await fetch(playersUrl);
                await this.sleep();
                if (!playersFetch.ok) {
                    throw new Error("Could not fetch players from Sleeper (" + playersFetch.status + ")");
                }

                let players = await playersFetch.json();
                let playersToSave = [];

                // Get roster position info from db
                result = await db.query('SELECT id, position FROM `rosterpositions`');
                if (result.length > 0) {
                    let positions = result.map(rp => ({
                        id: rp.id,
                        position: rp.position
                    }));
                
                    // Build new player object, add to array for saving
                    for (let p in players) {
                        let newPlayer = {
                            name: players[p]?.full_name,
                            team: players[p]?.team,
                            rosterPositionId: positions.find(po => po.position == players[p].position)?.id,
                            sleeperId: p
                        }
                        playersToSave.push(newPlayer);
                    }

                    for (let p of playersToSave) {
                        // we don't play with defenses (6). You could make this work if you took this out and
                        // did some additional tinkerering
                        if (!!p.rosterPositionId && p.rosterPositionId !== 6) {
                            let team = !!p.team ? '"' + p.team + '"' : null;
                            let name = !!p.name ? '"' + p.name + '"' : null;
                            let insertStr = 'INSERT INTO `sleeperplayers` \
                                    (name, team, rosterPositionId, sleeperId) \
                                    VALUES (' + name + ', ' + team + ', ' + p.rosterPositionId + ', ' + p.sleeperId + ')';

                            let result = await db.query(insertStr);
                        }
                    }
                    console.log('=================================');
                    console.log(' Updated Players DB from Sleeper');
                    console.log('=================================');
                }
                else {
                    console.error('ERROR - Could not find roster positions in DB');
                }
            }
            catch(e) {
                console.error(e);
            }
        }
        else {
            console.log('No update needed.');
        }
    },

    importMatchups: async function (db, leagueIds) {
        
        for (let league of leagueIds) {
            
            let year = league.year;
            let id = league.id;
            
            console.log('Importing matchups from Sleeper for year ' + year + '...');

            // Check if matchups have already been imported for this year
            result = await db.query('SELECT m.id FROM matchups m LEFT JOIN teams t ON t.id = m.teamId WHERE t.year = ' + year);
            if (result.length > 0) {
                console.log(year + ' matchups have already been imported.');
                continue;
            }

            // Get teams from database
            result = await db.query('SELECT id, sleeperId FROM teams WHERE year = ' + year);

            if (result.length > 0) {
                // Import matchups from Sleeper for each week of the season
                for (let week = 1; week <= 17; week++) {
                    try {
                        matchupsUrl = sleeperApiUrl + 'league/' + id + '/matchups/' + week;
                        let matchupsFetch = await fetch(matchupsUrl);
                        await this.sleep();
                        if (!matchupsFetch.ok) {
                            throw new Error("Could not fetch matchups from Sleeper (" + matchupsFetch.status + ") for week " + week + " of " + year);
                        }

                        let matchups = (await matchupsFetch.json()).map(m => ({
                            teamId: result.find(t => t.sleeperId == m.roster_id)?.id,
                            sleeperId: m.roster_id,
                            matchupId: m.matchup_id,
                            players: m.players,
                            starters: m.starters,
                            bench: m.players.filter(p => !m.starters.find(s => s == p)),
                            playerPoints: m.players_points,
                            week: week
                        }));

                        // Figure out who played who
                        let dbMatchups = [];
                        for (let matchup of matchups) {
                            let teamId = matchup.teamId;
                            let opponentId = matchups.find(
                                m => (matchup.matchupId && m.matchupId) 
                                     && (matchup.sleeperId != m.sleeperId) 
                                     && (matchup.matchupId == m.matchupId)
                            )?.teamId;
                            dbMatchups.push({
                                teamId: teamId,
                                opponentId: opponentId ? opponentId : null,
                                week: week,
                            });
                        }

                        // Add all matchups to database
                        for (let matchup of dbMatchups) {
                            let insertQuery = "INSERT INTO `matchups` (`teamId`, `opponentId`, `week`) VALUES \
                                               (" + matchup.teamId + ", " + matchup.opponentId + ", " + matchup.week + ")";
                            let result = await db.query(insertQuery);
                            if (!result) {
                                console.log('ERROR: Could not insert matchup for team' + matchup.teamId + ' for week ' + matchup.week + ' of year ' + year);
                            }
                        }
                        console.log('Successfully added matchups for week ' + week + ' of ' + year);

                        // Fetch all sleeper players from db
                        let sleeperPlayers = await db.query('SELECT name, team, rosterPositionId, sleeperId FROM sleeperplayers');
                        
                        // Get roster position info from db
                        let positions = await db.query('SELECT id, position FROM `rosterpositions`');
                        if (positions.length > 0) {
                            // Collect all player stats and add to database
                            if (sleeperPlayers.length > 0) {
                                for (let matchup of matchups) {
                                    // Add all starters
                                    for (let p of matchup.players) {
                                        // Get player data from imported Sleeper players
                                        let player = sleeperPlayers.find(sp => sp.sleeperId == p);
                                        if (!player) {
                                            console.error('ERROR - Could not find player with Sleeper ID #' + p);
                                            continue;
                                        }
                                        let positionStr = positions.find(po => po.id == player.rosterPositionId) ? "'" + positions.find(po => po.id == player.rosterPositionId).position + "'" : "NULL";
                                        let teamStr = player.team && player.team != 'null' ? "'" + player.team + "'" : 'NULL';

                                        // some silly billies have 's in their names!
                                        let nameStr = player.name.replace("'", "\\'");

                                        let insertQuery = "INSERT INTO `weeklyplayerstats` (`teamId`, `week`, `name`, `team`, `playerPosition`, `rosterPositionId`, `totalPoints`, `source`) VALUES \
                                                        (" + matchup.teamId + ", " + week + ", '" + nameStr + "', " + teamStr + ", " +  positionStr + ", " + player.rosterPositionId + ", " + (matchup.playerPoints[p] ? matchup.playerPoints[p] : "NULL") + ", 'sleeper')";
                                        let insertStatsResult = await db.query(insertQuery);
                                        if (!insertStatsResult) {
                                            console.error('ERROR - Could not insert player stats for ' + player.name + ' (matchup ID ' + matchup.matchupId + ', week ' + week + ', ' + year + ')');
                                        }
                                    }
                                }
                            }
                            else {
                                console.log('ERROR - Could not load Sleeper players from DB');
                            }
                        }                        
                    }
                    catch (e) {
                        console.error(e);
                    }
                }
            }
            else {
                console.error('ERROR - there are no teams for year ' + year);
            }
        }
    },

    importTrades: async function (db, leagueIds) {
        
        for (let league of leagueIds) {
            
            let year = league.year;
            let id = league.id;
            
            console.log('Importing trades from Sleeper for year ' + year + '...');

            // Check if matchups have already been imported for this year
            result = await db.query("SELECT id FROM trades WHERE source = 'sleeper' AND year = " + year);
            if (result.length > 0) {
                console.log(year + ' trades have already been imported.');
                continue;
            }

            // Get teams from database
            let teamsResult = await db.query('SELECT id, sleeperId FROM teams WHERE year = ' + year);

            if (teamsResult.length > 0) {
                // Import trades from Sleeper for each week of the season
                let trades = [];
                for (let week = 1; week <= 17; week++) {
                    try {
                        transactionsUrl = sleeperApiUrl + 'league/' + id + '/transactions/' + week;
                        let transactionsFetch = await fetch(transactionsUrl);
                        await this.sleep();
                        if (!transactionsFetch.ok) {
                            throw new Error("Could not fetch matchups from Sleeper (" + transactionsFetch.status + ") for week " + week + " of " + year);
                        }
                        let newTrades = (await transactionsFetch.json())
                            .filter(t => t.type == 'trade' && t.status == 'complete')
                            .map(nt => ({
                                adds: nt.adds,
                                drops: nt.drops,
                                rosterIds: nt.roster_ids,
                                wallet: nt.waiver_budget,
                            }));
                        
                        trades = [...trades, ...newTrades];
                    }
                    catch (e) {
                        console.error(e);
                    }
                }

                if (trades.length > 0) {
                    // Fetch all sleeper players from db
                    let sleeperPlayers = await db.query('SELECT name, team, rosterPositionId, sleeperId FROM sleeperplayers');
                    if (sleeperPlayers.length > 0) {
                        for (let trade of trades) {
                            let insertQuery = "INSERT INTO `trades` (`team1`, `team2`, `vetoed`, `year`, `source`) VALUES ";

                            // We are making a gross assumption here that all trades are two-team trades. Sleeper allows
                            // for multi-team trades, but we have never actually done this.
                            // If this script is run with multi-team trades, it will not properly record it.
                            let teams = [];
                            for (let i in trade.adds) {
                                if (teams.lastIndexOf(trade.adds[i]) < 0) {
                                    teams.push(trade.adds[i]);
                                }
                            }
                            let team1 = teamsResult.find(t => t.sleeperId == teams[0])?.id;
                            let team2 = teamsResult.find(t => t.sleeperId == teams[1])?.id;
                            insertQuery += "(" + team1 + ", " + team2 + ", false, " + year + ", 'sleeper')";

                            let tradeInsertResult = await db.query(insertQuery);
                            if (!tradeInsertResult) {
                                console.error('ERROR - Could not insert trade between teams ' + team1 + ' and ' + team2 + ' in year ' + year);
                                break;
                            }
                            let tradeId = tradeInsertResult.insertId;

                            for (let i in trade.adds) {
                                let newTeam = teamsResult.find(t => t.sleeperId == trade.adds[i])?.id;
                                let oldTeam = teamsResult.find(t => t.sleeperId == trade.drops[i])?.id;

                                if (newTeam && oldTeam) {
                                    let tradePlayerInsertQuery = "INSERT INTO `tradeplayers` (`tradeId`, `originalTeamId`, `newTeamId`, `name`, `team`, `position`, `source`) VALUES ";

                                    // Fetch all roster positions from db
                                    let rosterPositions = await db.query('SELECT id, position FROM rosterpositions');
                                    if (rosterPositions.length > 0) {
                                        let playerName = sleeperPlayers.find(sp => sp.sleeperId == i)?.name;
                                        let teamName = sleeperPlayers.find(sp => sp.sleeperId == i)?.team;
                                        let position = rosterPositions.find(rp => rp.id == sleeperPlayers.find(sp => sp.sleeperId == i)?.rosterPositionId)?.position;
                                        
                                        tradePlayerInsertQuery += "(" + tradeId + ", " + oldTeam + ", " + newTeam + ", '" + playerName + "', '" + teamName + "', '" + position + "', 'sleeper')";
                                        let tradePlayerInsertResult = await db.query(tradePlayerInsertQuery);
                                        if (!tradePlayerInsertResult) {
                                            console.error('ERROR - Could not insert player trade entry for ' + playerName + ' in trade ' + tradeId);
                                        }
                                    }
                                    else {
                                        console.error('Could not load roster positions from database');
                                    }
                                }
                                else {
                                    console.error('Could not find teams ' + newTeam + ' or ' + oldTeam);
                                }
                            }

                            // Add any FAAB transactions to the trade
                            for (let faab of trade.wallet) {
                                let newTeam = teamsResult.find(t => t.sleeperId == faab.receiver)?.id;
                                let oldTeam = teamsResult.find(t => t.sleeperId == faab.sender)?.id;
                                let playerName = 'FAAB';

                                let tradePlayerInsertQuery = "INSERT INTO `tradePlayers` (`tradeId`, `originalTeamId`, `newTeamId`, `name`, `position`, `source`) \
                                                              VALUES (" + tradeId + ", " + oldTeam + ", " + newTeam + ", '" + playerName + "', " + faab.amount + ", 'sleeper')";

                                tradePlayerInsertResult = await db.query(tradePlayerInsertQuery);
                                if (!tradePlayerInsertResult) {
                                    console.error('ERROR - Could not insert player trade entry for ' + playerName + ' in trade ' + tradeId);
                                }
                            }

                        }
                    }
                    else {
                        console.error('ERROR - No sleeper players in DB');
                    }
                }
            }
        }
    },

    importDrafts: async function(db, leagueIds) {
        
        for (let league of leagueIds) {

            let year = league.year;
            let leagueId = league.id;
            
            console.log('Importing draft results from Sleeper for year ' + year + '...');

            // Check if draft results have already been imported for this year
            result = await db.query("SELECT d.id FROM draftresults d LEFT JOIN teams t on t.id = d.teamId WHERE source = 'sleeper' AND year = " + year);
            if (result.length > 0) {
                console.log(year + ' draft results have already been imported.');
                continue;
            }

            // Get teams from database
            let teams = await db.query('SELECT id, sleeperId, name, year FROM teams WHERE year = ' + year);
            if (teams.length <= 0) {
                console.error('ERROR - Could not load teams from DB');
                continue;
            }

            // We are going to make the assumption that each league only has one draft. I'm not actually sure
            // what the case is where a league would have multiple drafts...
            try {
                let draftsUrl = sleeperApiUrl + 'league/' + leagueId + '/drafts';
                let draftsFetch = await fetch(draftsUrl);
                await this.sleep();
                if (!draftsFetch.ok) {
                    throw new Error(1);
                }

                // heres the gross assumption!
                let draftData = (await draftsFetch.json())[0];
                let draftId = draftData.draft_id;

                let draftPicksUrl = sleeperApiUrl + 'draft/' + draftId + '/picks';
                let draftPicksFetch = await fetch(draftPicksUrl);
                await this.sleep();
                if (!draftPicksFetch.ok) {
                    throw new Error(2);
                }

                let draftPicks = (await draftPicksFetch.json()).map(p => ({
                    draftPosition: p.pick_no,
                    // some silly billies have 's in their names!
                    name: (p.metadata.first_name + ' ' + p.metadata.last_name).replace("'", "\\'"),
                    team: p.metadata.team,
                    position: p.metadata.position,
                    teamId: teams.find(t => t.sleeperId == p.roster_id && t.year == year)?.id,
                    teamName: teams.find(t => t.sleeperId == p.roster_id && t.year == year)?.name,
                }));

                for (let pick of draftPicks) {
                    console.log('Pick #' + pick.draftPosition + ': ' + pick.name + '(' + pick.position + ' - ' + pick.team + ') to ' + pick.teamName);

                    let position = pick.position ? "'" + pick.position + "'" : "null";
                    let team = pick.team ? "'" + pick.team + "'" : "null";

                    let insertQuery = "INSERT INTO `draftresults` (`name`, `team`, `position`, `draftPosition`, `teamId`, `source`) VALUES \
                                       ('" + pick.name + "', " + team + ", " + position + ", " + pick.draftPosition + ", " + pick.teamId + ", 'sleeper')";
                    let result = await db.query(insertQuery); 
                    if (!result) {
                        console.error('ERROR - Could not insert draft pick ' + pick.name + ' to DB (' + year + ', team: ' + pick.teamId + ')');
                    }
                }
            }
            catch (e) {
                if (e === 1) {
                    console.error('ERROR - Could not fetch drafts from Sleeper for year ' + year);
                }
                else if (e === 2) {
                    console.error('ERROR - Could not fetch draft picks from Sleeper for year ' + year);
                }
                else {
                    console.error('ERROR - Unexpected error while fetching draft data for year ' + year);
                    console.log(e);
                }
            }

        }
    },
}