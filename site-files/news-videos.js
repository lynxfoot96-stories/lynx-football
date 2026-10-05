/* Shared by index.html and news-article.html.
   To add a new video: add one line to VIDEOS (id = YouTube id, c = category, t = title,
   k = specific keywords, g = weaker related words). Keywords are lowercase, no accents. */
(function(){
  /* ---------- Video library (from index.html) + keywords used to match news -> videos ----------
     k = specific keywords (strong signal), g = generic keywords (weak signal).
     To add a new video, add a line here: id = YouTube id, t = title, c = category. */
  var VIDEOS=[
    {id:"nc6c7jM9PWo",c:"Rankings",t:"Top 10 Best Dribblers in Football 2026",k:["dribbler","dribblers","dribbling","dribble","yamal","vinicius","doku","neymar"],g:["skill","winger"]},
    {id:"Np7JDYQYLlo",c:"Ballon d'Or",t:"Top 10 Ballon d'Or 2026 Favorites",k:["ballon d'or","golden ball","yamal","mbappe","kane","haaland","dembele","vinicius","raphinha","salah"],g:["award","trophy"]},
    {id:"Xip-DiSw7ww",c:"Ballon d'Or",t:"Top 10 Ballon d'Or 2026 Favorites: Mbappé, Haaland, Kane & Lamine Yamal Battle for Glory!",k:["ballon d'or","mbappe","haaland","kane","yamal"],g:["award"]},
    {id:"HgW1GYJPV_k",c:"Ballon d'Or",t:"Why Mbappé Cannot Win the 2026 Ballon d'Or!",k:["mbappe","ballon d'or"],g:["real madrid"]},
    {id:"EzTdNWR2RU4",c:"World Cup",t:"Top 10 Best Players of the 2026 FIFA World Cup",k:["world cup","2026 world cup","mbappe","yamal","kane","haaland","vinicius"],g:["national team","international","fifa","squad","argentina","brazil","france","england","spain","portugal"]},
    {id:"uDdyBLHiUrs",c:"World Cup",t:"7 Players Who Will Miss the 2026 World Cup",k:["injury","injured","injuries","ruled out","miss the world cup","world cup"],g:["setback","fitness"]},
    {id:"QE55jKsD6-4",c:"Rankings",t:"Top 10 Best Young Football Talents in 2026: Future Superstars",k:["young","youngster","teenager","wonderkid","talent","yamal","endrick","mainoo","cubarsi","estevao","doue","prospect"],g:["future","academy"]},
    {id:"TVsvwbfpYnI",c:"Rankings",t:"Top 10 Most Skillful Football Players in the World Right Now (2026-27)",k:["skillful","skills","skill","yamal","doku","vinicius","dribbling"],g:["flair"]},
    {id:"c5O6ZirRSg4",c:"Rankings",t:"10 Most Expensive Transfers (2026)",k:["expensive","fee","record fee","transfer fee","world record"],g:["transfer","million","deal","bid"]},
    {id:"hSav90FEvPE",c:"Rankings",t:"Top 10 Highest-Paid Footballers in 2026",k:["salary","wages","highest-paid","highest paid","earnings","contract","al nassr","al-nassr","saudi","ronaldo"],g:["money","deal","pay"]},
    {id:"K7j7Wz7XgyU",c:"Rankings",t:"The Best World XI of 2026! Ultimate Football Team",k:["world xi","best xi","team of the year","lineup","line-up"],g:["best players","starting xi"]},
    {id:"8TF8DNcUE0k",c:"Champions League",t:"5 Favorites to Win the Champions League 2026/27",k:["champions league","uefa"],g:["favorites","final","knockout","group stage","quarter-final","semi-final"]},
    {id:"chu8LDD44j0",c:"Champions League",t:"Top 10 Champions League Players With the Most Goals + Assists",k:["champions league"],g:["goals","assists","scorer"]},
    {id:"CEbDJ-8g6wA",c:"Champions League",t:"Top 5 Favorites to Win the 2025/26 Champions League",k:["champions league"],g:["favorites","final"]},
    {id:"7T3lMV6ZDCo",c:"Transfer News",t:"Julián Álvarez Is Trapped at Atlético Madrid… And Barcelona Wants Him!",k:["alvarez","julian alvarez","atletico","atletico madrid"],g:["barcelona","transfer"]},
    {id:"jk4gxpUT1oQ",c:"Transfer News",t:"Marcus Rashford's Barcelona Move Explained",k:["rashford","manchester united"],g:["barcelona","loan","transfer"]},
    {id:"CZwg7gM04hg",c:"Transfer News",t:"Gyökeres to Arsenal (2025)",k:["gyokeres","arsenal","sporting"],g:["striker","transfer"]},
    {id:"08JZduXAN2k",c:"Transfer News",t:"Where Should Rodrygo Go? (2025)",k:["rodrygo"],g:["real madrid","transfer","exit","future"]},
    {id:"AA1OVpB42ko",c:"Player Story",t:"Messi Back to Barcelona? The Truth Behind His Possible Comeback",k:["messi","lionel messi","inter miami","barcelona"],g:["comeback","return","argentina"]},
    {id:"-CjZjWIuoa4",c:"Player Story",t:"Ousmane Dembélé's Rise: From €135M Flop at Barcelona to Ballon d'Or Contender with PSG",k:["dembele","psg"],g:["barcelona","ballon d'or"]},
    {id:"Tj56FYgQKRc",c:"Ballon d'Or",t:"Why Ousmane Dembélé Deserves the Ballon d'Or",k:["dembele","psg","ballon d'or"],g:["award"]},
    {id:"0XiPOuL2iAs",c:"Ballon d'Or",t:"Ballon d'Or 2025: Top 10 Favorites Revealed! Who Will Win the Golden Ball?",k:["ballon d'or","golden ball","dembele","yamal","raphinha","vitinha"],g:["award"]},
    {id:"hVwv4sMR6pg",c:"Ballon d'Or",t:"Ballon d'Or 2025: Top 10 Contenders So Far",k:["ballon d'or","contender","contenders"],g:["award"]},
    {id:"g6JG8_G-Rxw",c:"Ballon d'Or",t:"Robbed of the Ballon d'Or",k:["robbed","snub","snubbed","ballon d'or"],g:["controversy","award"]},
    {id:"w39rSomACM4",c:"Ballon d'Or",t:"Why Pelé & Maradona Never Won the Ballon d'Or",k:["pele","maradona"],g:["ballon d'or","legend"]},
    {id:"IbezD6FgO6U",c:"Ballon d'Or",t:"The 10 Best Footballers Who Never Won the Ballon d'Or!",k:["never won the ballon d'or","xavi","iniesta","buffon","maldini","lahm","gerrard","lampard"],g:["ballon d'or"]},
    {id:"g1znANo5gu4",c:"Latest Upload",t:"Top 10 Players With the Most Goals in the 21st Century",k:["cristiano ronaldo","ronaldo","messi","lewandowski","haaland","kane","mbappe","benzema","suarez"],g:["goals","goalscorer","goal scorer","scorer","striker","scoring","top scorer"]},
    {id:"DocGb430F_U",c:"Rankings",t:"Top 10 Greatest Strikers of All Time",k:["striker","strikers","ronaldo","haaland","lewandowski","kane","mbappe","gyokeres","benzema","suarez","ibrahimovic","batistuta","van basten","henry","romario","klose","aguero","drogba","shearer"],g:["goals","scorer"]},
    {id:"EvQYpD6RhNQ",c:"Rankings",t:"Top 10 Players with the Most Assists in Football History",k:["assist","assists","xavi","iniesta","de bruyne","ozil","modric","kroos","playmaker"],g:["midfield","creator","messi"]},
    {id:"LtHmNzh2HnY",c:"Rankings",t:"Top 10 Free-Kick Takers in Football History",k:["free kick","free-kick","free kicks","beckham","juninho","pirlo","mihajlovic","alexander-arnold"],g:["set piece","messi","ronaldo"]},
    {id:"zPtR_KY-v0A",c:"Records",t:"The Origin of the Panenka: Football's Most Iconic Penalty",k:["panenka","penalty","penalties","spot-kick","shootout"],g:["spot kick"]},
    {id:"JFL1s9TYH3M",c:"Records",t:"10 Football Records That Will Never Be Broken",k:["record","records","unbreakable","pele"],g:["history","ronaldo","messi"]},
    {id:"Tt_wxAwRheU",c:"World Cup",t:"10 Unbreakable World Cup Records That Will Never Be Broken",k:["world cup","klose","record","records"],g:["goals"]},
    {id:"GQQ0GaV5GDk",c:"World Cup",t:"Football Legends Who Never Won the World Cup",k:["world cup","never won","ronaldo","haaland","salah","cruyff","zlatan","eusebio"],g:["portugal","legend"]},
    {id:"-22jW_eVljU",c:"Rankings",t:"Top 10 Greatest Footballers of All Time, Ranked by ChatGPT",k:["greatest","goat","messi","ronaldo","pele","maradona","cruyff"],g:["all time","ranking","legend"]},
    {id:"tawrkloni40",c:"Rankings",t:"The Greatest Football Player From Every Country",k:["greatest player","portugal","argentina","brazil","france","england","spain","germany","italy","croatia"],g:["national team","country"]},
    {id:"pTYLKM2gklI",c:"Rankings",t:"10 Most Skillful Players in Football History: Ronaldinho, Messi, Maradona, Neymar",k:["ronaldinho","messi","maradona","neymar","skillful","skills"],g:["skill","dribbling"]},
    {id:"QOh7G_eOujs",c:"Rankings",t:"Top 10 Greatest Dribblers of All Time",k:["dribbler","dribblers","dribbling","dribble","maradona","neymar","ronaldinho","messi"],g:["skill"]},
    {id:"IWbQbZLQar0",c:"Rankings",t:"10 Greatest Wingers of All Time",k:["winger","wingers","vinicius","yamal","neymar","garrincha","robben","ribery","salah","bale","figo"],g:["wing","pace"]},
    {id:"abrSX_13NDY",c:"Rankings",t:"Top 10 Fastest Footballers in the World (2025)",k:["fastest","pace","speed","sprint","adama traore","davies"],g:["mbappe"]},
    {id:"oxJbAKAxtFM",c:"Rankings",t:"10 Most Expensive Football Transfers Ever",k:["expensive","record fee","neymar","coutinho","fee"],g:["transfer","million","deal"]},
    {id:"yk1xGUSyjns",c:"Rankings",t:"7 Biggest Transfer Flops in Football",k:["flop","flops","disaster"],g:["transfer","signing","fee","million"]},
    {id:"3gy19nOF5UM",c:"Rankings",t:"7 Most Underrated Players",k:["underrated","overlooked"],g:[]},
    {id:"N694m5AdeWI",c:"Rivalries",t:"6 Football Legends Who Played for Real Madrid & Barcelona",k:["luis figo","figo","ronaldo nazario","clasico","el clasico","real madrid","barcelona"],g:["rival","rivalry","legend"]},
    {id:"sc_G7ZPVaS0",c:"Rivalries",t:"Lamine Yamal vs Lionel Messi After 100 Games",k:["yamal","lamine yamal","messi"],g:["barcelona","argentina","spain"]},
    {id:"EOrJqebdkik",c:"Channel",t:"Football's Most Iconic Player Presentations Ever!",k:["presentation","unveil","unveiled","unveiling","introduced","welcomed"],g:["signing","jersey","shirt","kit","stadium"]}
  ];
  var FALLBACK=["g1znANo5gu4","hSav90FEvPE","nc6c7jM9PWo"];

  function norm(s){return String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[’‘`]/g,"'")}
  function count(text,key){
    var re=new RegExp("(^|[^a-z0-9])"+key.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"(?=[^a-z0-9]|$)","g");
    var m=text.match(re);return m?m.length:0;
  }
  function matchVideos(title,rest,n){
    var T=norm(title),B=norm(rest),scored=[];
    VIDEOS.forEach(function(v,idx){
      var s=0;
      (v.k||[]).forEach(function(k){k=norm(k);if(count(T,k))s+=4;s+=Math.min(count(B,k),3)*1.5});
      (v.g||[]).forEach(function(k){k=norm(k);if(count(T,k))s+=1;s+=Math.min(count(B,k),2)*0.5});
      if(s>=3)scored.push({v:v,s:s,i:idx});
    });
    scored.sort(function(a,b){return b.s-a.s||a.i-b.i});
    var out=scored.slice(0,n).map(function(x){return x.v}),matched=out.length>0;
    FALLBACK.forEach(function(id){
      if(out.length>=n)return;
      var v=VIDEOS.filter(function(x){return x.id===id})[0];
      if(v&&out.indexOf(v)<0)out.push(v);
    });
    return {list:out,matched:matched};
  }


  window.FSVideos={VIDEOS:VIDEOS,matchVideos:matchVideos};
})();
