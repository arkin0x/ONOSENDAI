# ONOSENDAI オノセンダイ
A cyberspace client for the one true metaverse: [nostr](https://github.com/nostr-protocol/nostr)

![onosendai](https://user-images.githubusercontent.com/99223753/222729991-068aa52c-977a-4d74-bd2b-f643070db4eb.png)

ONOSENDAI visualizes objects on the nostr protocol in an interactive 3D world referred to as 'cyberspace'.

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

*The ideal experience is currently desktop. There are fairly large bugs on iOS Safari.*

# Concept: Semantic Coordinate System

Each nostr note (`kind 1`) is assigned a 3D point in cyberspace based on the _meaning_ of its content.

This is done by simhashing the content. Simhash is different from normal hashing because small variations in the preimage yield small variations in the resulting hash. Two very similar preimages will yield two very similar hashes. Likewise, two very similar statements will yield two very similar coordinates.

First, we create a 256-bit [simhash](http://matpalm.com/resemblance/simhash/) of the content: `simhash(content)`. The 256-bit simhash is embedded into 3 coordinates of 85 bits each with 1 bit unused. The coordinates are scaled down to fit within a coordinates system of `-2^53 + 1 <= x <= +2^53 - 1` so that it is compatible with JavaScript's Number primitive (and Three.js).

Other `kinds` may have their coordinates derived in other ways that are better suited to convey their meaning, such as simhashing event tags, pubkeys, timestamp, or using event ids and proof of work (see below).

### Conclusion 🧠💭

The Semantic Coordinate System is a 3D space where the vector of human ideas can be explored and quantified.

Clusters of notes are like clusters of similar ideas, which is a great place to explore if you want a steady feed of interesting content about a topic.

Lone notes in the distant void of cyberspace may represent entirely unique ideas that could be very valuable and rare.

Addressing notes by _meaning_ in a _public_, _decentralized_, _visual_ space is a new way of exploring the wealth of human knowledge, and I hope that this leads to the discovery and generation of even more ideas for the benefit of mankind.

> When I say the notes are addressed by meaning, I am referring to the loose relationship between the meaning > words > bytes > simhash > coordinates. There are potentially better algorithms for addressing similar content into tighter groups. Simhash, while much less entropic than a pure SHA256 address, still introduces a lot of randomness in how notes are distributed across cyberspace. However, keeping the algorithm simple and abstract prevents addressing problems, prevents bias, and prevents addressing from becoming essentially an opinionated search engine. The simhash algorithm is well worn, deterministic, and unbiased. There are other tools like keyword filters and web-of-trust to help users find related and relevant content as they explore. If you know of a simple, unbiased algorithm that would work better than simhash, please get in touch. I'm not an expert at this stuff. I'm just building.

# Concept: Proof of Work for Localization of Constructs

Perhaps moreso than any other digital medium in history, Cyberspace is well-suited for 3D interactive experiences. As such, placing 3D objects in Cyberspace is a self-evident necessity. Luckily, it can be done in a permissionless way.

`Constructs` are nostr events of `kind 10333` that contain 3D geometry in a [common 3D format](https://github.com/mrdoob/three.js/tree/dev/examples/jsm/loaders) to be rendered by a cyberspace client (planned ONOSENDAI feature).

Rather than placing 3D geometry in cyberspace by simhash (as raw geometry code is not very meaningful) the 3D coordinates of the `Construct` can be derived from the event id instead.

Although different from [NIP-13](https://github.com/nostr-protocol/nips/blob/master/13.md), proof of work can be utilized to mine the event ID hash so that the desired (approximate) coordinates can be achieved when the ID is embedded into 3D coordinates. This kind of mining will be more expensive as it requires more bits of the hash to match and each resulting hash to be transformed into coordinates to check the result.

The precision of 3 85-bit coordinates is much more than necessary to display an object's position, especially when downscaling the coordinate space, so the least significant bits can be ignored when mining construct locations. However, a new NIP could treat least-significant-bit zeroes in each 85-bit coordinate as POW so that content filters can treat mined locations as more legitimate.

Limiting the scale of Constructs is necessary so that they do not span (and spam) the entire metaverse, but rather take up a more reasonable amount of real estate. One idea is that a client could clip each construct to a bounding cube of a fixed size, or, POW size could increase the size of the bounding box as well.

A Turing-incomplete language could be repurposed or developed to enable basic cyberspace-context scripting for `Constructs` to take them beyond decorations and give them more utility.

### Conclusion 🧠💭

This proof of work system for claiming real-estate in cyberspace provides similar benefits to Bitcoin's proof of work system. As long as there is consensus for construct location addressing in cyberspace, the proof of work directed toward mining a location for a construct has value, and therefore the real estate in cyberspace has value. This approach is superior to all other virtual real estate schemes that unnecessarily utilize blockchains, have arbitrary costs unduly influenced by market conditions, or are beholden to centralized brokers. In cyberspace, land is acquired by work, property is secured like bitcoin, and it all runs on nostr.

# Concept: Planes & Extensibility

Many types of data can be visualized in cyberspace. The goal with ONOSENDAI is to think outside the box for what a nostr client can do and maximize the usefulness of visualizing the nostr protocol, but other protocols such as bitcoin, IPV4/6, etc. could be visualized or incorporated in additional layers or `planes` that could be toggled on or off as the user desires.

I am interested in applying all of the above concepts to meatspace as well, creating a cyberspace plane that can be experienced through augmented reality. I've already built the augmented reality client (nostr not integrated yet): https://yondar.me

# Concept: Presence

The idea of using [ephemeral events to publish one's presence](https://nips.be/p/160) could be used to **optionally** share your current position in cyberspace so that other users can visualize your movement and interact with you.

Each pubkey can be embedded into a coordinate address (no simhash). This would be the `default` location for a pubkey in cyberspace. But if the pubkey publishes a presence event of their current cyberspace coordinate, then other users will see them at that place too.

The presence event could contain vector information (speed + direction) so their movement could be approximated.

Once ONOSENDAI implements DMs and Zaps, this foundation for representing a pubkey's movement and position in cyberspace can make cyberspace into a public commons where all manner of human activity can take place.

Text-to-Speech APIs built into modern browsers could be used to turn nostr events into audible dialog. Public notes could be heard at a volume relative to their distance. This type of note may be a different `kind` or have some special indicator.

## Implementation 😅🛠

- [x] Address `kind 1` events by simhash
- [x] Flight/navigation controls
- [x] `kind 1` new state
- [x] `kind 1` selected state
- [x] `kind 1` read state
- [ ] `kind 1` bookmarked state
- [x] Bookmark events (stored locally)
- [x] Persist bookmarked events (localStorage)
- [ ] Persist read events (simhash + id only) so you can skip over them
- [ ] Address `pubkeys` directly
- [ ] Zap visualization for `kind 1`
- [ ] Persist recently traveled routes and visualize them
- [ ] Presence event changes pubkey's location
- [ ] Scale universe controls
- [ ] Address `kind 10333` events by event id
- [ ] Load `kind 10333` geometry
- [ ] NIP-26 for sign-in
- [ ] Publish kind 1 notes from ONOSENDAI
- [ ] Search/filter notes by string
- [ ] Filter POW for notes
- [ ] Filter POW for constructs
- [ ] VR support

## Support FOSS You Believe In ⚡

If you'd like to support ONOSENDAI development, you can zap me at arkinox@getalby.com or become a sponsor. Get in touch with me on [nostr](https://snort.social/p/npub1arkn0xxxll4llgy9qxkrncn3vc4l69s0dz8ef3zadykcwe7ax3dqrrh43w), npub1arkn0xxxll4llgy9qxkrncn3vc4l69s0dz8ef3zadykcwe7ax3dqrrh43w

Join the official ONOSENDAI Telegram: [https://t.me/ONOSENDAITECH](https://t.me/ONOSENDAITECH)

Other great ways to contribute:

- pull requests
- sharing ideas & expertise
- bug reports
- reading scifi
- and telling your friends!

## IYKYK 📖

If you don't know where the name ONOSENDAI comes from, then I beg you to please read "Neuromancer" by William Gibson.

# FAQ

### Q: Cyberspace? Seriously? What is this all about?

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

In my opinion, it is **only** in the context of bitcoin and nostr that something like cyberspace could conceivably exist. Without the decentralized properties of nostr and bitcoin, cyberspace is just another 3D game owned by a company. However, when cyberspace is decentralized, enforces property rights, responds to proof of work, and enables instant value transfer, it becomes something entirely different.

Because cyberspace inherits all of these unique properties from nostr and because value transfer can be executed in cyberspace through bitcoin lightning, I argue that it is time for humanity to take another look at this dusty old concept and start exploring it with renewed interest.

I, unlike many metaverse enthusiasts, have a strong moral preference for reality over illusion. The idealized metaverse or cyberspace worlds that Meta and the like want to build are nothing more than a drug used to extract resources from miserable VR-goggled souls. That is the fiat version of cyberspace and it sucks. I am not interested in building clever simulations that seek to replace reality. I want to build _tools_ that enable people to connect and be more productive. I want to open up new channels for communication, innovation, and human flourishing in reality.

Cyberspace is a new way to visualize the new paradigm for digital communication and property. It is wholly based around cryptography and digital ownership. If not for these things, cyberspace would be irrelevant.

A cyberspace built on decentralized protocols and sound money — nostr and bitcoin — has the potential to be something innovative, healthy, and ultimately productive for humanity. Cyberspace can be something where wealth is not extracted but rather generated by work and free markets. Cyberspace could be a new medium of connection built on sound principles that can enable humanity to do new things not previously dreamed of.


If it were not for the profound inventions of bitcoin and nostr, these aspirations would be nothing but ludicrous and delusional. In fact, any metaverse or cyberspace built outside of the context of bitcoin and nostr are delusional at best and Machiavellian at worst. Spoiler: it's the latter in most cases.

Thanks for coming to my TED talk. Let's build.

### Q: How do I log in with my private key/browser extension?

### A:

You can't login yet. ONOSENDAI can't yet do anything on your behalf. See the implementation checklist for upcoming features.
