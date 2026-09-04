# A bunker-signed HOSAKA payment, recognised after the phone's app switch

Reproduces the incident of 2026-09-03: an invoice paid from a wallet app on a
phone was never recognised, because the tab's relay sockets came back
half-open (the browser still called them connected) and the bunker signature
for the next claim poll went into the void.

The pieces: a local relay (`nak serve`), a TCP proxy in front of it that can
play dead (`halfopen-proxy.mjs`: existing connections stay open and forward
nothing, new ones work), a NIP-46 remote signer (`fake-bunker.mjs`) talking to
the relay directly, and a Playwright run of the app (`bunker-payment-e2e.mjs`)
that logs in through the bunker via the proxy, stubs HOSAKA, commits a move
the cloud must do, hides the tab, kills the sockets, "pays", returns, and
measures how long the client takes to notice.

```
nak serve --port 10547 &
node scripts/e2e/bunker-payment/halfopen-proxy.mjs 10548 10547 10549 &
node scripts/e2e/bunker-payment/fake-bunker.mjs ws://127.0.0.1:10547 bunker.log keys.json &
npx vite --port 5211 --strictPort --host 127.0.0.1 &
node scripts/e2e/bunker-payment/bunker-payment-e2e.mjs 5211 run keys.json bunker.log
```

Pass: `recognisedAfterSeconds` is a few seconds and `signRequestsAfterReturn`
is at least 1. Before the fix the run ended in `FLOW DIED` ("All promises were
rejected") or hung with the spinner. `PLAYWRIGHT_BROWSERS_PATH` may be needed
where the browsers live outside the default cache.
