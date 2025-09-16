# sleeper-fantasy-history-importer
Long, but fairly self-explanatory title

## Description

This script was built to import Sleeper fantasy football history to import into a database that
was already built by importing history from an NFL.com fantasy football league. A lot of strange-seeming
assumptions have been made about data that may make more sense if you view it from a lens of unifying
data from an NFL.com league.

## How to Run

1. Make sure you have node installed on your PC.

2. Use the SQL schema in /schema/nerdherd.sql to create the structure in your MySQL database of choice.

3. Run the following:
  ```bash
  npm install
  node main.js
  ```
