/**
 * Lithuanian interface text: the source of truth for message keys. `en.ts` must provide the same
 * keys. Movie titles are never translated (FR-017); they come from the cinemas.
 *
 * Plural messages list one form per Intl.PluralRules category: Lithuanian uses `one` (1, 21, 31…),
 * `few` (2–9, 22–29…), `many` (fractions) and `other` (0, 10–20, 30…).
 */
export type PluralForms = { other: string } & Partial<
  Record<'zero' | 'one' | 'two' | 'few' | 'many', string>
>;

/**
 * "In Vilnius" in Lithuanian changes the city's name, and the data only has the name itself. A city
 * not here reads "Kino seansai: {name}", and a test reports it (page-head.test.ts).
 */
export const cityLocatives: Record<string, string> = {
  vilnius: 'Vilniuje',
  kaunas: 'Kaune',
  klaipeda: 'Klaipėdoje',
  siauliai: 'Šiauliuose',
  panevezys: 'Panevėžyje',
};

export const lt = {
  'app.name': 'Seansai',
  'layout.skipToContent': 'Pereiti prie turinio',
  'layout.languageSwitch': 'Kalba',
  'layout.updatedAt': 'Atnaujinta {time}',
  'common.loading': 'Kraunama…',
  'poster.noImage': 'Plakato nėra',
  'movieList.title': 'Dabar rodomi filmai',
  'movie.screenings': 'Seansai',
  'notFound.title': 'Puslapis nerastas',
  'notFound.body': 'Tokio puslapio nėra. Galbūt nuoroda pasenusi.',
  'notFound.backToList': 'Grįžti į filmų sąrašą',
  'notFound.movieTitle': 'Filmas nerastas',
  'notFound.movieBody': 'Šio filmo mūsų sąraše nebėra. Galbūt jo seansai jau baigėsi.',
  'common.retry': 'Bandyti dar kartą',
  'error.title': 'Nepavyko įkelti',
  'error.body': 'Nepavyko gauti duomenų. Patikrinkite interneto ryšį ir bandykite dar kartą.',
  'city.promptTitle': 'Pasirinkite miestą',
  'city.promptBody': 'Rodysime šio miesto kino teatrų seansus. Pasirinkimą įsiminsime.',
  'city.all': 'Visa Lietuva',
  'city.change': 'Keisti miestą',
  'city.choiceLabel': 'Miestas',
  'city.choiceBody': 'Rodome visos Lietuvos seansus. Norite matyti tik savo miesto?',
  'city.choose': 'Pasirinkti miestą',
  'city.keepAll': 'Palikti visą Lietuvą',
  'head.listTitle': 'Kino seansai visoje Lietuvoje – Seansai',
  'head.listDescription': 'Visų Lietuvos kino teatrų seansai vienoje vietoje.',
  'head.cityTitle': 'Kino seansai {place}',
  'head.cityDescription':
    'Filmai ir kino seansai {place}: kas rodoma ir kada, su bilietų nuorodomis.',
  'head.cityTitleNoForm': 'Kino seansai: {place}',
  'head.cityDescriptionNoForm':
    'Filmai ir kino seansai: {place}. Kas rodoma ir kada, su bilietų nuorodomis.',
  'head.movieTitle': '{name} – seansai',
  'head.movieDescription': 'Filmo „{name}“ seansai Lietuvoje.',
  'head.genres': 'Žanras: {genres}.',
  'head.notFoundTitle': 'Puslapis nerastas – Seansai',
  'movie.nextShowing': 'Artimiausias seansas: {date}. Kur: {places}.',
  'movie.morePlaces': '{places} ir kt',
  'city.cinemaCount': {
    one: '{count} kino teatras',
    few: '{count} kino teatrai',
    many: '{count} kino teatro',
    other: '{count} kino teatrų',
  },
  'search.label': 'Ieškoti filmo',
  'search.placeholder': 'Lietuviškas arba originalus pavadinimas',
  'search.clear': 'Išvalyti paiešką',
  'search.noResults': 'Pagal „{query}“ filmų nerasta.',
  'movieList.byCity': 'Pagal miestą',
  'movieList.empty': 'Šiame mieste artimiausių seansų nėra.',
  'movieList.emptyBody': 'Pabandykite pasirinkti kitą miestą arba visą Lietuvą.',
  'movieCard.today': {
    one: '{count} seansas šiandien',
    few: '{count} seansai šiandien',
    many: '{count} seanso šiandien',
    other: '{count} seansų šiandien',
  },
  'movieCard.from': 'Nuo {date}',
  'movie.duration': '{minutes} min.',
  'movie.ageRating': 'Amžiaus cenzas',
  'movie.today': 'Šiandien',
  'movie.noMoreToday': 'Šiandien seansų nebeliko',
  'movie.noScreeningsOnDate': 'Šią dieną seansų nėra',
  'movie.nextDate': 'Artimiausi seansai – {date}',
  'movie.noUpcoming': 'Šiame mieste artimiausių šio filmo seansų nėra.',
  'movie.unavailableDate': 'Šios datos pasirinkti negalima, todėl rodomi šiandienos seansai.',
  'movie.loadingDate': 'Kraunami seansai…',
  'datePicker.label': 'Pasirinkite datą',
  'datePicker.hasScreenings': 'yra seansų',
  'filters.toggle': 'Filtrai',
  'filters.toggleCount': 'Filtrai ({count})',
  'filters.cinema': 'Kino teatras',
  'filters.format': 'Formatas',
  'filters.otherFormat': 'Kitas',
  'filters.clear': 'Išvalyti filtrus',
  'filters.shown': 'Rodoma {shown} iš {total}',
  'filters.noMatch': 'Pagal pasirinktus filtrus seansų nėra',
  'filters.noMatchBody': 'Pakeiskite filtrus arba juos išvalykite.',
  'common.close': 'Uždaryti',
  'screening.buyTicket': 'Pirkti bilietą',
  'screening.ticketContext': '{time}, {cinema}; atsidaro naujame skirtuke',
  'stale.title': 'Kai kurie duomenys gali būti pasenę',
  'stale.body':
    'Nepavyko atnaujinti šių kino teatrų tvarkaraščių, todėl jų seansų gali trūkti arba jie gali būti pasenę: {cinemas}.',
  'screenings.count': {
    one: '{count} seansas',
    few: '{count} seansai',
    many: '{count} seanso',
    other: '{count} seansų',
  },
} satisfies Record<string, string | PluralForms>;

/** Every catalogue has the same keys; plain strings stay strings, plurals stay plurals. */
export type Messages = {
  [Key in keyof typeof lt]: (typeof lt)[Key] extends string ? string : PluralForms;
};
