# ONOSENDAI オノセンダイ
The reference metaverse client for the permissionless, decentralized, thermodynamic [cyberspace meta-protocol built on nostr](https://github.com/arkin0x/cyberspace)

![onosendai-pano](https://user-images.githubusercontent.com/99223753/223734919-ee5fc4d0-ee89-409c-a7c8-1848310bb92d.png)

ONOSENDAI enables human agents to interact with the 3D extension of reality known as 'cyberspace'.

Try it out at [https://onosendai.tech](https://onosendai.tech)

[Check out the FAQ](#faq)

https://user-images.githubusercontent.com/99223753/223145715-31174a68-9bc5-4c06-abb2-5f3a1e1352a6.mp4
> Music from #Uppbeat (free for Creators!):
> https://uppbeat.io/t/hey-pluto/miami-1987
> License code: VLG0ATMLGHSH4MT8

## Controls

**Desktop**

 - WASD/arrow keys - move
 - click - read
 - click + drag - look
 - R - up
 - F - down

**Mobile**

 - touch 2 fingers - move forward
 - drag - look
 - tap - read

*The ideal experience is currently desktop. There are bugs on iOS Safari.*

## Concepts and Explanations

In our universe all actions require energy expenditure as entropy and all actions are permissionless; the only way to oppose an action in reality is to expend energy. Cyberspace is a meta-protocol on the permissionless nostr protocol, and all actions in cyberspace have a thermodynamic cost via proof-of-work. Therefore, cyberspace is a digital extension of reality because cyberspace shares those 2 fundamental properties with reality: it is permissionless and thermodynamic.

Short explanation of cyberspace as an extension of reality: [https://telegra.ph/Cyberspace-and-Proof-of-Work-04-17](https://telegra.ph/Cyberspace-and-Proof-of-Work-04-17)

In-depth explanation of cyberspace: [Nostr: The Dawn of Cyberspace](https://yakihonne.com/article/naddr1qq25ce6ff3ny7mm40ff42hmgfue52mn4244ngq3qarkn0xxxll4llgy9qxkrncn3vc4l69s0dz8ef3zadykcwe7ax3dqxpqqqp65wackq8r)

Nostrovia podcast all about cyberspace: [Nostrovia Web Player](https://podcasters.spotify.com/pod/show/nostrovia/episodes/A-Metaverse-on-Nostr---Arkinox-e23moeq)

arkinox video talk about ONOSENDAI and cyberspace: [https://youtu.be/6POq0eaW1J0](https://youtu.be/6POq0eaW1J0) (ignore the weird video spam at 3:20)

### How does proof-of-work enable movement and other actions in cyberspace?

Here is a concrete example of how movement will work soon with POW.

First, you will choose a speed with your throttle — a UI element that controls how fast you wish to go, which will probably default to 1. When you press the ⬆️ arrow on your keyboard, ONOSENDAI will begin mining a Drift event with proof-of-work equal to your throttle speed. Once an event with the desired amount of proof-of-work is found, it is published as an event to nostr relays to broadcast your location, and you will move forward in cyberspace on your screen.

Your machine doing the proof-of-work will have an upper bound to how much proof-of-work it can complete per second. The throttle is how many units of proof-of-work you are requiring your machine to mine per Drift event; remember also that the proof-of-work is the amount of acceleration you gain per event. Let's say, for example, that your machine can very easily mine a 5 proof-of-work (POW) event every second. If you keep your throttle at 5, you will gain 5 acceleration roughly every second; I say roughly as POW can obviously vary in how long it takes to complete.

Now let's say for example that you move your throttle up to 10. ONOSENDAI now requires that your machine mine 10 units of POW before it publishes a Drift event allowing you to move. Let's also say that your machine cannot do a 10 POW every second, but only once every 3 seconds. Now, your movement through cyberspace will be more choppy, because you will get a burst of speed roughly every 3 seconds instead of a smaller burst of speed every 1 second with a 5 throttle.

This creates a dynamic where you must find the sweet spot for your hardware that allows you to move quickly and consistently. If you set your throttle to 20, you may only mine a 20 POW event every minute. This will cause your movement to be very stunted and inconsistent, and you will spend a lot of time not moving at all; when you do mine the POW 20 event, you will blast off like a rocket. But if you set your throttle to 1, you will smoothly and consistently mine a Drift event every second (or quicker, depending on your hardware).

All actions in cyberspace require POW, and all actions are represented by nostr events. To put POW into a nostr event, one must simply define the target POW (throttle) inside the event, and then determine the event's ID which is a SHA256 hash of the serialized event. If the resulting event ID has leading binary zeroes equal to the POW defined in the event, the POW is valid; otherwise, the POW is invalid and hashing continues. This hashing is the thermodynamic expenditure of energy, just like bitcoin. This is described in detail in NIP-13 in the nostr protocol.

There are other resource-intensive actions that ONOSENDAI will be performing besides mining events for POW. Therefore, I am building a user interface system where the user can control how ONOSENDAI focuses your machine's resources. There are 3 categories of task that require processing power: movement, actions, and observation. ONOSENDAI will give the user 10 "points" and allow them to assign these points to the three categories at any moment. Each point represents 10% of your machine's total processing power. If you assign 5 points to movement, 3 to actions, and 2 to observation, then 50% of your machine's processing power will be used to mine Drift events, 30% will be used to mine other action events like vortex, bubble, derezz, armor, etc., and 20% of your machine's power will be use for validating other operator's movement chains, attempting to detect the location of cloaked operators, and processing environmental information. At any moment the user can reassign these points with simple keystrokes, taps, macros, or button presses to change the thermodynamic posture of their cyberspace operator. If you've played the game Elite Dangerous you will be familiar with this kind of realtime resource management. If one needs to move somewhere fast, they may temporarily assign 10 points to movement. If one is in a crowd of other operators, one may assign 2 points to movement and 8 points to observation to process the other operators' information quickly.

On very powerful machines, balancing their CPU resources may not be challenging or necessary. But since I want people on any device to have the opportunity to utilize cyberspace effectively, I think that having UI to control how their thermodynamic resources are applied to cyberspace is important.

Likewise with other cyberspace actions such as Derezz, one will need to choose the right throttle/POW amount so that they balance power and speed based on their current situation, taking into account where other operators are and how powerful or fast they appear to be.

There is an inverse relationship between the power one has in cyberspace and the speed at which one can use their power, and this is scaled by your hardware's capacity for hashing. One can cast powerful events slowly or weak events quickly. This tradeoff is controlled simply by proof-of-work, which is the thermodynamic aspect of cyberspace.

## Ideaspace

ONOSENDAI is an [i-space](https://github.com/arkin0x/cyberspace#cyberspace-meta-protocol) client.

![ideaspace-alpha-white](https://github.com/arkin0x/ONOSENDAI/assets/99223753/eabe3b48-0bce-4377-b6ae-f1406dba66bd)

## Implementation 😅🛠

### cyberspace meta-protocol [https://github.com/arkin0x/cyberspace](https://github.com/arkin0x/cyberspace)

- [ ] Construct
- [ ] Shards
- [ ] Operators
- [ ] Drift
- [ ] Derezz
- [ ] Armor
- [ ] Vortex
- [ ] Bubble
- [ ] Stealth
- [ ] Shout

### client features

- [x] Address `kind 1` events by simhash
- [x] Flight/navigation controls
- [x] `kind 1` new state
- [x] `kind 1` selected state
- [x] `kind 1` read state
- [x] `kind 1` bookmarked state
- [x] Bookmark events (stored locally)
- [x] Acceleration-based controls to handle large distances
- [x] Visualize speed
- [x] Show current coordinates
- [x] Mobile: 2x touch to accelerate
- [x] Mobile: 3x touch to reverse
- [x] Persist bookmarked events (localStorage)
- [ ] Cross-browser testing and fixes
- [ ] Mobile: scroll event content by touch
- [ ] Mobile: gyroscope controls to look (but keep drag-to-look controls)
- [ ] Note access history panel
- [ ] Persist read events (simhash + id only) so you can skip over them
- [ ] Zap visualization for `kind 1`
- [ ] Visualize traveled routes
- [ ] Add a marker to nearby notes so they are easier to track; marker should hug edge of screen if the note is nearby but not in frustum
- [ ] NIP-26 for sign-in
- [ ] speech-to-text-to-speech communication
- [ ] Publish kind 1 notes from ONOSENDAI
- [ ] Search/filter notes by string
- [ ] Locate note by entering Event ID
- [ ] Locate user by entering pubkey
- [ ] Filter POW for notes
- [ ] Filter POW for constructs
- [ ] VR support

## Support FOSS You Believe In ⚡

If you'd like to support ONOSENDAI development, you can contribute at our [geyser.fund](https://geyser.fund/project/onosendai) zap me at arkinox@getalby.com or become a sponsor. Get in touch with me on [nostr](https://snort.social/p/npub1arkn0xxxll4llgy9qxkrncn3vc4l69s0dz8ef3zadykcwe7ax3dqrrh43w), npub1arkn0xxxll4llgy9qxkrncn3vc4l69s0dz8ef3zadykcwe7ax3dqrrh43w

Join the official ONOSENDAI Telegram: [https://t.me/ONOSENDAITECH](https://t.me/ONOSENDAITECH)

Other great ways to contribute:

- pull requests
- sharing ideas & expertise
- bug reports
- reading sci-fi
- and telling your friends!

Check out the cyberspace spec and contribute: https://github.com/arkin0x/cyberspace

npub1arkn0xxxll4llgy9qxkrncn3vc4l69s0dz8ef3zadykcwe7ax3dqrrh43w

NIP-05 arkinox@arkinox.tech

## Name

"ONOSENDAI" is the name of the device of Japanese manufacture that allows one to connect their mind to cyberspace in the foundational sci-fi book "Neuromancer" by William Gibson.

# FAQ

### Q: Cyberspace? Metaverse? Seriously? What is this all about?

### A: 

Cyberspace (in this context) is an early-internet trope from the 80s. It's an enthusiastic and naive speculation on the future of network-connected computers and how humans might use them. Ultimately, instead of interacting in 3D virtual spaces, humans ended up interacting via documents in web browsers which is much more practical and efficient than 3D visualizations.

Besides the problem of visualizing content, there are several more critical problems with the ['shared consensual hallucination'](https://www.goodreads.com/quotes/14638-cyberspace-a-consensual-hallucination-experienced-daily-by-billions-of-legitimate) — problems rarely (if ever) addressed in fiction: 

- Who hosts it?
- Who decides how it looks?
- Who owns the content?
- Who makes the rules?
- Who assigns the space?
- Who controls it?

These questions are answered satisfactorily in the era of bitcoin and nostr:

- Who hosts it? **nostr relays**
- Who decides how it looks? **nostr clients**
- Who owns the content? **users cryptographically own their content**
- Who makes the rules? **open source consensus**
- Who assigns the space? **an impartial algorithm + proof of work**
- Who controls it? **NOBODY**

In my opinion, it is **only** in the context of bitcoin and nostr that something like cyberspace could conceivably exist. Without the decentralized and permissionless properties of nostr and bitcoin, cyberspace is just another 3D game owned by a company. However, when cyberspace is decentralized, enforces property rights, responds to proof of work, and enables instant value transfer, it becomes something entirely different.

If it were not for the profound inventions of bitcoin and nostr, metaverse aspirations would be nothing but ludicrous and delusional, because a centralized permissioned metaverse does not accomplish anything more than being a video game, and a metaverse without proof-of-work only succeeds in mirroring the existing power structures in society and computing today.

Thanks for coming to my TED talk. Let's build.

### Q: How do I log in with my private key/browser extension?

### A:

You can't login yet. ONOSENDAI can't yet do anything on your behalf. See the implementation checklist for upcoming features.

# License

<a rel="license" href="http://creativecommons.org/licenses/by-sa/4.0/"><img alt="Creative Commons License" style="border-width:0" src="https://i.creativecommons.org/l/by-sa/4.0/88x31.png" /></a><br />This work is licensed under a <a rel="license" href="http://creativecommons.org/licenses/by-sa/4.0/">Creative Commons Attribution-ShareAlike 4.0 International License</a>.
