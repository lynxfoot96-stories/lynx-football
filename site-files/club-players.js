/* club-players.js — compatibility stub.
 * The squad cards (Team tab) and the top-scorer cards (Key Players tab) are now rendered by club-tabs.js
 * for every club. Club pages still call FSKeyPlayers.mount(...) at the bottom; this stub makes that call
 * do nothing, so it no longer dumps the 15-player list into Key Players and no longer makes duplicate API calls.
 * You can later delete this file together with the <script src="club-players.js"> and FSKeyPlayers.mount lines. */
window.FSKeyPlayers = { mount: function () {} };
