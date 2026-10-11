/* =====================================================================================
   YOUR VIDEO LIST  -  the only file you need to edit to add videos.
   -------------------------------------------------------------------------------------
   * NEWEST FIRST: put each new video at the TOP of the list (just under the "[" line).
   * The home page (one video per theme) and the Videos page build themselves from this list.
   * Easiest way to add a video: paste its YouTube link in quotes and add a comma:

         "https://youtu.be/XXXXXXXXXXX",

     The title is fetched from YouTube and the theme is guessed from the title.
   * Want to control the theme or the title? Use the longer form instead:

         {id:"XXXXXXXXXXX", c:"Rankings", t:"My video title"},

     Themes: Ballon d'Or, Transfer News, Rankings, World Cup, Champions League,
             Player Story, Records, Rivalries, Channel
   * Thumbnail: automatic from YouTube. If you want your own picture, save it as
     video-thumbs/XXXXXXXXXXX.jpg (XXXXXXXXXXX = the video id) and it is used instead.
   ===================================================================================== */
window.FS_VIDEOS = [
  /* ---- add new videos here (top = newest) ---- */
  {id:"mQKrux9qc8Y", c:"Channel"},

  {id:"IWbQbZLQar0", c:"Rankings", t:"10 Greatest Wingers of All Time"},
  {id:"yk1xGUSyjns", c:"Rankings", t:"7 Biggest Flops in Football"},
  {id:"g1znANo5gu4", c:"Rankings", t:"Top 10 Players With the Most Goals in the 21st Century"},
  {id:"IbezD6FgO6U", c:"Ballon d'Or", t:"The 10 Best Footballers Who Never Won the Ballon d'Or!"},
  {id:"chu8LDD44j0", c:"Champions League", t:"Top 10 Champions League Players With the Most Goals + Assists"},
  {id:"8TF8DNcUE0k", c:"Champions League", t:"5 Favorites to Win the Champions League 2026/27"},
  {id:"7T3lMV6ZDCo", c:"Transfer News", t:"Julián Álvarez Is Trapped at Atlético Madrid… And Barcelona Wants Him!"},
  {id:"QE55jKsD6-4", c:"Rankings", t:"Top 10 Best Young Football Talents in 2026: Future Superstars"},
  {id:"TVsvwbfpYnI", c:"Rankings", t:"Top 10 Most Skillful Football Players in the World Right Now (2026-27)"},
  {id:"HgW1GYJPV_k", c:"Ballon d'Or", t:"Why Mbappé Cannot Win the 2026 Ballon d'Or!"},
  {id:"K7j7Wz7XgyU", c:"Rankings", t:"The Best World XI of 2026! Ultimate Football Team"},
  {id:"tawrkloni40", c:"Rankings", t:"The Greatest Football Player From Every Country"},
  {id:"c5O6ZirRSg4", c:"Rankings", t:"10 Most Expensive Transfers (2026)"},
  {id:"Np7JDYQYLlo", c:"Ballon d'Or", t:"Top 10 Ballon d'Or 2026 Favorites"},
  {id:"Tt_wxAwRheU", c:"World Cup", t:"10 Unbreakable World Cup Records That Will Never Be Broken"},
  {id:"EzTdNWR2RU4", c:"World Cup", t:"Top 10 Best Players of the 2026 FIFA World Cup"},
  {id:"GQQ0GaV5GDk", c:"World Cup", t:"Football Legends Who Never Won the World Cup"},
  {id:"hSav90FEvPE", c:"Rankings", t:"Top 10 Highest-Paid Footballers in 2026"},
  {id:"zPtR_KY-v0A", c:"Records", t:"The Origin of the Panenka: Football's Most Iconic Penalty"},
  {id:"uDdyBLHiUrs", c:"World Cup", t:"7 Players Who Will Miss the 2026 World Cup"},
  {id:"pTYLKM2gklI", c:"Rankings", t:"10 Most Skillful Players in Football History: Ronaldinho, Messi, Maradona, Neymar"},
  {id:"LtHmNzh2HnY", c:"Rankings", t:"Top 10 Free-Kick Takers in Football History"},
  {id:"Xip-DiSw7ww", c:"Ballon d'Or", t:"Top 10 Ballon d'Or 2026 Favorites: Mbappé, Haaland, Kane & Lamine Yamal Battle for Glory!"},
  {id:"EvQYpD6RhNQ", c:"Rankings", t:"Top 10 Players with the Most Assists in Football History"},
  {id:"DocGb430F_U", c:"Rankings", t:"Top 10 Greatest Strikers of All Time"},
  {id:"EOrJqebdkik", c:"Channel", t:"Football's Most Iconic Player Presentations Ever!"},
  {id:"3gy19nOF5UM", c:"Rankings", t:"7 Most Underrated Players"},
  {id:"CEbDJ-8g6wA", c:"Champions League", t:"Top 5 Favorites to Win the 2025/26 Champions League"},
  {id:"nc6c7jM9PWo", c:"Rankings", t:"Top 10 Best Dribblers in Football 2026"},
  {id:"JFL1s9TYH3M", c:"Records", t:"10 Football Records That Will Never Be Broken"},
  {id:"abrSX_13NDY", c:"Rankings", t:"Top 10 Fastest Footballers in the World (2025)"},
  {id:"QOh7G_eOujs", c:"Rankings", t:"Top 10 Greatest Dribblers of All Time"},
  {id:"g6JG8_G-Rxw", c:"Ballon d'Or", t:"Robbed of the Ballon d'Or"},
  {id:"w39rSomACM4", c:"Ballon d'Or", t:"Why Pelé & Maradona Never Won the Ballon d'Or"},
  {id:"CZwg7gM04hg", c:"Transfer News", t:"Gyökeres to Arsenal (2025)"},
  {id:"jk4gxpUT1oQ", c:"Transfer News", t:"Marcus Rashford's Barcelona Move Explained"},
  {id:"Tj56FYgQKRc", c:"Ballon d'Or", t:"Why Ousmane Dembélé Deserves the Ballon d'Or"},
  {id:"-22jW_eVljU", c:"Rankings", t:"Top 10 Greatest Footballers of All Time, Ranked by ChatGPT"},
  {id:"AA1OVpB42ko", c:"Player Story", t:"Messi Back to Barcelona? The Truth Behind His Possible Comeback"},
  {id:"08JZduXAN2k", c:"Transfer News", t:"Where Should Rodrygo Go? (2025)"},
  {id:"oxJbAKAxtFM", c:"Rankings", t:"10 Most Expensive Football Transfers Ever"},
  {id:"0XiPOuL2iAs", c:"Ballon d'Or", t:"Ballon d'Or 2025: Top 10 Favorites Revealed! Who Will Win the Golden Ball?"},
  {id:"-CjZjWIuoa4", c:"Player Story", t:"Ousmane Dembélé's Rise: From €135M Flop at Barcelona to Ballon d'Or Contender with PSG"},
  {id:"sc_G7ZPVaS0", c:"Rivalries", t:"Lamine Yamal vs Lionel Messi After 100 Games"},
  {id:"N694m5AdeWI", c:"Rivalries", t:"6 Football Legends Who Played for Real Madrid & Barcelona"},
  {id:"hVwv4sMR6pg", c:"Ballon d'Or", t:"Ballon d'Or 2025: Top 10 Contenders So Far"},
  {id:"YonQXm1D7X8", c:"Player Story", t:"What Happened to Vinicius Junior in 2025?"},
];
