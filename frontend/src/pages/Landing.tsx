
==> Frontend install + build

added 74 packages, and audited 76 packages in 2s

7 packages are looking for funding
  run `npm fund` for details

2 moderate severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.

> build
> tsc -p tsconfig.json && vite build

src/pages/Landing.tsx:5:29 - error TS2307: Cannot find module '../../lib/wsClient' or its corresponding type declarations.

5 import { BrpWsClient } from "../../lib/wsClient";
                              ~~~~~~~~~~~~~~~~~~~~

src/pages/Landing.tsx:6:28 - error TS2307: Cannot find module '../../lib/api' or its corresponding type declarations.

6 import { createRoom } from "../../lib/api";
                             ~~~~~~~~~~~~~~~

src/pages/Landing.tsx:7:54 - error TS2307: Cannot find module '../../lib/storage' or its corresponding type declarations.

7 import { loadMasterSession, saveMasterSession } from "../../lib/storage";
                                                       ~~~~~~~~~~~~~~~~~~~

src/pages/Landing.tsx:62:21 - error TS7006: Parameter 'm' implicitly has an 'any' type.

62         onMessage: (m) => onMsg(m),
                       ~

src/pages/master/Landing.tsx:35:67 - error TS2353: Object literal may only specify known properties, and 'master_key' does not exist in type 'JoinParams'.

35       { room_code: session.room_code, device_id: "master_device", master_key: session.master_key },
                                                                     ~~~~~~~~~~


Found 5 errors in 2 files.

Errors  Files
     4  src/pages/Landing.tsx:5
     1  src/pages/master/Landing.tsx:35
