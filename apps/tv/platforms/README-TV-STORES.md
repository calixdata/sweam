# Packaging SweamTV for Samsung and LG TVs

The TV app is hosted at **https://tv.sweam.co** (served by the `sweam` Worker
from `apps/web/dist/tv`). Both store packages here are thin shells whose
`index.html` loads that URL, so shipping an app update never requires a store
resubmission — redeploying the Worker is the update.

## Samsung (Tizen) — `tizen/`

1. Install Tizen Studio with the TV extension and create a Samsung developer
   certificate (Tools > Certificate Manager; a Samsung account is required).
2. In Tizen Studio: File > Import > Tizen project, pointing at this `tizen/`
   folder (it holds `config.xml`, `index.html`, `icon.png`).
3. Right-click the project > Build Signed Package → produces a `.wgt`.
4. Test on a TV: enable Developer Mode on the TV (Apps > `12345` on the
   remote, enter the PC's IP), then Right-click > Run As > Tizen Web
   Application.
5. Store: apply at seller.samsungapps.com (Samsung Apps TV Seller Office),
   create the app, upload the `.wgt`, fill the listing, submit for review.

## LG (webOS) — `webos/`

1. Install webOS TV SDK / ares CLI: `npm install -g @webos-tools/cli`.
2. Package: `ares-package apps/tv/platforms/webos` → `co.sweam.tv_0.1.0_all.ipk`.
3. Test on a TV: enable Developer Mode with LG's Developer Mode app, register
   the TV (`ares-setup-device`), then `ares-install --device <tv> <ipk>`.
4. Store: apply at seller.lgappstv.com (LG Seller Lounge), create the app,
   upload the `.ipk`, fill the listing, submit for QA.

## Notes

- The icons here are the approved SweamTV brand art (kit v1.1 at
  `SWEAMTV/SWEAMTV LOGO/SweamTV-Kit-v1.1`, which also holds Apple TV
  layered assets, Android/Google TV adaptive resources and Fire TV art for
  the future native builds).
- Both stores review against their UX checklists: the hosted app already
  handles D-pad navigation, the platform Back keys (Tizen 10009, webOS 461),
  big type, and visible focus.
- The pairing flow (code on TV, claim at sweam.co/activate) is the sign-in
  both stores expect for account-based apps.
