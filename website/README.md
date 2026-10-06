# Hotel Panama Canal website proposal

Five static Spanish pages, responsive navigation, room and gallery dialogs,
an unsent consultation draft, commercial WhatsApp link and link to the existing
PMS `/reservar?demo=1`. No external libraries, analytics or embedded maps.

The PMS demo reads the existing public availability endpoint only. Check-in and
manual credit examples live in browser memory. They are not PMS records.
The normal `/reservar` route remains unchanged. No new backend endpoints,
credentials, CORS permissions, payment integrations or database mutations.

Images show the region, not hotel facilities. Originals and CC BY-SA licenses
are credited on `creditos.html`. Build downloads the two approved originals
from Wikimedia and verifies SHA256 before publishing; browsers load local
copies from the static site. Historical hotel photos are excluded. Room
categories and example rates are fictional. Public institutional email is
pending verification; personal emails are excluded.

## Proposed Render static configuration

- Existing repository `hbouche/Hotelcanalpms`, main.
- Build command: `node website/render-build.mjs`
- Publish directory: `website/site`
- Environment: `SKIP_INSTALL_DEPS=true`, explicit `SITE_MODE=withdrawn` or `full`
- Auto deploy: off. No paid compute or disk for the static site.

Create the tiny `withdrawn` artifact first and retain its deploy ID. Publish
`full`, exercise withdrawal, and restore `full`. The withdrawn artifact has
only a small index/404 page and excludes images, JS and PMS links. A Dashboard
rollback can reuse it without a rebuild while its artifact remains retained.
The approved demo bandwidth budget is USD 5/month, with preventive withdrawal
at USD 1 attributable to the demo or an unexplained surge. This is a soft
budget: metering delay and small HTTP/error responses can still incur charges.
Never claim a hard or zero-risk cap. Monitor only bandwidth for budget control.

Do not create/deploy until workspace spending conditions are verified. Static
hosting has no base fee, but public outbound overages cost USD 0.15/GB and
pipeline minutes may be purchased automatically. A USD 0 pipeline spend limit
does not establish a bandwidth cap. Do not remove an existing payment method
from the workspace: it also serves the existing PMS.

## Existing PMS deployment safeguards

Verified baseline: main/live commit
`643453fb3f1a12c0b3a79dd662d3d533910b2326`, service
`srv-davpnde0tbcc73etcm3g`, disk `dsk-davpndm0tbcc73etcmh0`,
mount `/var/data`, size 1GB, auto-deploy off.

This change does not touch server code, schema, `render.yaml`, environment
variables or existing data. Deploy uses the same persistent disk. Roll back
to the verified baseline through Render's prior deploy after a backup is
confirmed. Local backup smoke encountered Windows `EPERM fsync`; a successful
current production backup has not been verified. Do not treat this local error
as evidence of a production failure. Operational daypass changes remain local
and are excluded from this deployment.

## Validation

Frontend builds with Node 22. Local QA covers all five pages at
320/390/768/1024/1440px; modal, gallery, mobile navigation, unsent consultation,
commercial link, PMS route, public GET-only policy and fictional scenario.
PMS screenshots use isolated fictional responses; they do not prove a deployed
live connection. Verify both public URLs after deployment.
