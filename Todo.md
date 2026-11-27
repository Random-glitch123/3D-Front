# RUN
use hg 

npm run build
Client - npm run dev
Server - npm run start

taskkill /f /im node.exe

https://threed-front-server.onrender.com/warm

## Done 

Base-map
Main menu
Basic Connection between host and client

Server constantly alive (due to cronjob)

Server currently uses up only 10MB
https://threed-front-server.onrender.com


- Soldier economy based on hex ownership with biome multipliers
- Grassland/Forest: 1.2x (12 base), Tundra/Mountain/Snow/Beach: 1.0x (10), Desert/Ice: 0.7x (7)
- Passive generation: 50 soldiers/sec/hex (adjustable via SOLDIERS_PER_SECOND_PER_HEX in shared/protocol.ts)
- Max 500 soldiers/hex (cities will increase later)
- Starting hex selection: players click land hex + pick from 15 colors
- UI: Soldier panel (top-left), Hex tooltip (hover), Starting hex selector overlay
- Visual ownership: 25% player color tint on owned hexes
- Server-authoritative with 1-second tick loop for passive generation
- Starting hexes: fixed click/raycast crash, countdown bar fills left->right, globe stops spinning
- Taking over hexes: single-click selects your hex, double-click adjacent target attacks; combat + capture
- Singleplayer: same economy/ownership/selector/UI running on a local simulation (no server)

### Done

Base-map
Main menu
Basic Connection between host and client

Server constantly alive (due to cronjob)

Server currently uses up only 10MB
https://threed-front-server.onrender.com


- Soldier economy based on hex ownership with biome multipliers
- Grassland/Forest: 1.2x (12 base), Tundra/Mountain/Snow/Beach: 1.0x (10), Desert/Ice: 0.7x (7)
- Passive generation: 50 soldiers/sec/hex (adjustable via SOLDIERS_PER_SECOND_PER_HEX in shared/protocol.ts)
- Max 500 soldiers/hex (cities will increase later)
- Starting hex selection: players click land hex + pick from 15 colors
- UI: Soldier panel (top-left), Hex tooltip (hover), Starting hex selector overlay
- Visual ownership: 25% player color tint on owned hexes
- Server-authoritative with 1-second tick loop for passive generation
- Starting hexes: fixed click/raycast crash, countdown bar fills left->right, globe stops spinning
- Taking over hexes: single-click selects your hex, double-click adjacent target attacks; combat + capture
- Singleplayer: same economy/ownership/selector/UI running on a local simulation (no server)
- Radial menu (right-click): Attack, Build, Ally, Trade, Transfer, Defend, Scout, Cancel with real SVG icons
- Build submenu: City, Factory, Base, Capital, Upgrade, Demolish, Back
- Building system: City (+10 pop/level), Factory (+5 gold/sec/level), Base (+2% soldier gen, stacks), Capital (1.5x total pop, one per player)
- Construction time: 10s (city/factory/base), 15s (capital)
- Building costs in client/public/building-costs.json (easy to edit)
- Capital destroyed when captured (capturer does NOT get it), falls to ash
- Population & soldier allocation slider (0-100%, default 20%) at bottom
- Attack allocation slider (0-100%, default 50%) at bottom
- Gold currency from factories
- Players can demolish own buildings (50% gold refund)

### TODO

add trees and oil

add trade

cities (raise per-hex cap and training rate) - DONE (merged into building system)
