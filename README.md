# sleeper-fantasy-history-importer
Long, but fairly self-explanatory title

## Description

This script was built to import Sleeper fantasy football history to import into a database that
was already built by importing history from an NFL.com fantasy football league. A lot of strange-seeming
assumptions have been made about data that may make more sense if you view it from a lens of unifying
data from an NFL.com league.

## Disclaimer

This is very much a quick and dirty script. It was built specifically for my own personal use, and I cannot guarantee it will work if you try to use it on another league.

If you did want to use it on a different league, this probably would be a good base to build off of.

## How to Run

1. Make sure you have node installed on your PC.

2. Use the SQL schema in /schema/nerdherd.sql to create the structure in your MySQL database of choice.

3. Create a settings.json file. See settings.json.example for an example of which fields are needed. This is required for the script to run correctly.

4. Run the following:
  ```bash
  npm install
  node main.js
  ```
