# Hotel Panama Canal — website and normal booking flow

Five Spanish responsive pages connect directly to the existing PMS `/reservar`. The home search passes category, date and people into the ordinary booking widget. Reservations persist in the normal hotel tables, start Pending with zero payment, affect availability and appear in reception. Test rates remain explicitly illustrative. No automatic charges or communications are enabled for these test products.

Approved HB visuals: four WebP concepts under 350000 bytes each, checked against Git blob SHA in approved-concepts.json. Two room angles derive from one historical reference and do not document two actual categories. Pool people and offer art are AI concepts, publicly labelled. Two original regional photographs retain credits and licenses; the hero is a destination landscape, not a verified hotel view.

Existing Render static service uses main, build `node website/render-build.mjs`, publish `website/site`, SKIP_INSTALL_DEPS=true, SITE_MODE=full or withdrawn. Auto deploy remains off. Withdrawal explicitly overwrites all six image paths with zero bytes, five HTML pages and small CSS/JS. Merely omitting files did not remove cached old Render assets. Browser/CDN caches can persist temporarily.

USD 5/month is the authorized soft bandwidth budget, not a hard cap. Existing hourly aggregate-bandwidth watch withdraws conservatively at 5000 MB or unexplained surge. Do not inspect access logs, usage or analytics. No new service, disk, domain, account, credential, paid plan or integration is added.

Normal database preload and safeguards are documented in `docs/normal-web-preload.md`. Older isolated DEMO code/data are retained but no longer selected by `/reservar`, even with the old demo query. No old synthetic reservation is migrated into the hotel's normal records.

Local QA includes normal API booking/reception/cancellation, same-day pass overlap, legacy person pricing, additive seed idempotency, desktop/mobile layouts and all approved images. Deployment receipts and captures are under proposal/deliverables.
