import {covers, bibleArt} from './library-covers.js';

const collections = ['scripture', 'early-christian', 'christian-classics'];
const labels = {
  all: 'All works',
  scripture: 'Bible',
  'early-christian': 'Early Christian Works',
  'christian-classics': 'Christian Classics',
  favorites: 'Favorites',
};
const featured = ['npnf101:vi', 'anf09:xii.iv', 'classics:imitation'];
const aliases = {
  Genesis:['Gn'], Exodus:['Ex'], Psalms:['Ps','Psa','Psalm'],
  Matthew:['Mt'], Mark:['Mk'], Luke:['Lk'], John:['Jn','Joh'], Romans:['Ro','Rom'],
  '1 John':['1Jn'], '2 John':['2Jn'], '3 John':['3Jn'],
  '1 Corinthians':['1Co','1Cor'], '2 Corinthians':['2Co','2Cor'],
  James:['Jas','Jm'], Philippians:['Php'], Revelation:['Rev','Re'],
};
const escape = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize = value => value.toLowerCase().trim().replace(/\s+/g,' ');
const compact = value => normalize(value).replaceAll(' ','');
const downArrow = '<span class="library-arrow" aria-hidden="true">⌄</span>';
const arrow = '<span class="library-arrow" aria-hidden="true">→</span>';
const reference = ({book, chapter, verse}) => `${book.title} ${chapter}${verse ? ':'+verse : ''}`;

export function connectLibrary(dialog, books, getReader, emit, icons) {
  const byId = new Map(books.map(book => [book.id,book]));
  const scripture = books.filter(book => book.corpus === 'scripture');
  const works = books.filter(book => book.corpus !== 'scripture');
  const newTestament = new Set(scripture.slice(scripture.findIndex(book => book.title === 'Matthew'),
    scripture.findIndex(book => book.title === 'Revelation') + 1).map(book => book.id));
  const names = new Map(scripture.map(book => [book.id,[book.title,...(aliases[book.title] ?? [])].map(compact)]));
  const touchLayout = matchMedia('(max-width:700px)');
  let screen, origin, pickerBack, step, testament, selected, chapter, canon, passageQuery, active;
  let collection = 'all', workQuery = '', limit = 36, favorites = new Set(), recent = [];

  function model() { return getReader(); }
  function saved(index) { return model().libraryLocations?.[index]; }
  function bibleTitle() { return model().translation ? 'Modern Standard Bible' : 'World English Bible'; }
  function canRead(book) { return canon === 2 || (canon === 1 ? book.catholic : book.protestant); }
  function testamentOf(book) { return newTestament.has(book.id) ? 'new' : 'old'; }
  function scriptureLocation() {
    const location = saved(0);
    const book = byId.get(location?.book);
    return book ? {book, chapter:location.chapter, id:location.id} : {book:scripture[0], chapter:1};
  }
  function findBooks(text) {
    const input = compact(text);
    if (!input) return [];
    const matches = scripture.filter(book => canRead(book) && names.get(book.id).some(name => name.startsWith(input)));
    return matches.sort((a,b) => Number(names.get(b.id).includes(input)) - Number(names.get(a.id).includes(input)));
  }
  function matches() {
    if (!passageQuery.trim()) return [];
    const parsed = normalize(passageQuery).match(/^(.+?)[ .]*(\d+)(?:\s*[:.]\s*(\d*))?$/);
    if (parsed) {
      const [, name, chapterText, verseText] = parsed;
      const number = Number(chapterText);
      const verse = verseText ? Number(verseText) : undefined;
      const refs = findBooks(name).flatMap(book => {
        const entry = book.chapters.find(([n]) => n === number);
        if (!entry || (verse !== undefined && (verse < 1 || !entry[1].some(([min,max]) => verse >= min && verse <= max)))) return [];
        return [{book,chapter:number,verse}];
      });
      if (refs.length || verseText !== undefined) return refs.slice(0,8);
    }
    return findBooks(passageQuery).slice(0,8).map(book => ({book}));
  }
  function heading(title, subtitle) {
    return `<div class="library-heading"><div><h2 id="library-title">${escape(title)}</h2>${subtitle ? `<p>${escape(subtitle)}</p>` : ''}</div>
      <button type="button" class="library-close" data-action="close" aria-label="Close">${icons.close}</button></div>`;
  }
  function navigation(current) {
    return `<nav class="library-nav" aria-label="Library navigation">
      <button type="button" data-action="home" ${current === 'library' ? 'aria-current="page"' : ''}>Your reading</button>
      <button type="button" data-action="picker" ${current === 'picker' ? 'aria-current="page"' : ''}>Bible</button>
      <button type="button" data-action="browse" ${current === 'browse' ? 'aria-current="page"' : ''}>Library</button>
    </nav>`;
  }
  function cover(book) {
    const image = covers[book.id];
    return image ? `<img class="library-cover" src="${image}" alt="" width="60" height="88" loading="lazy" decoding="async">`
      : '<span class="library-cover library-cover-blank" aria-hidden="true"></span>';
  }
  function workCard(book, controls = false) {
    const title = escape(book.title);
    const isFavorite = favorites.has(book.id);
    return `<div class="library-work">
      <button type="button" class="library-work-open" data-work="${escape(book.id)}">${cover(book)}
        <span><strong>${title}</strong><small>${escape(book.author || labels[book.corpus])}</small></span>${arrow}
      </button>
      ${controls ? `<div class="library-work-controls">
        <button type="button" data-contents="${escape(book.id)}" aria-label="Chapters of ${title}">Chapters</button>
        <button type="button" data-favorite="${escape(book.id)}" aria-label="Favorite ${title}" aria-pressed="${isFavorite}">${isFavorite ? '★' : '☆'}</button>
      </div>` : ''}
    </div>`;
  }
  function home() {
    const location = scriptureLocation();
    const reader = model();
    const excerpt = reader.scripture
      ? [...document.querySelectorAll('#reader-text .passage')].find(node => node.dataset.passageId === reader.location)?.textContent?.trim().split(/(?<=[.!?])\s/)[0]?.slice(0,160)
      : '';
    const featuredBooks = [...new Set([saved(1)?.book,saved(2)?.book,...featured])].map(id => byId.get(id)).filter(Boolean).slice(0,3);
    return `${heading('Your reading')}${navigation('library')}
      <section class="library-hero" aria-label="Continue reading">
        <div><p class="library-kicker">${escape(bibleTitle())}</p><h3>${escape(reference(location))}</h3>
        ${excerpt ? `<p class="library-excerpt">${escape(excerpt)}</p>` : ''}
        <div class="library-hero-actions">
          <button class="library-primary" type="button" data-action="continue">Continue reading ${arrow}</button>
          <button class="library-secondary" type="button" data-action="picker">Find a passage</button>
        </div></div>
        <img src="${bibleArt}" alt="Christ Pantocrator, sixth-century Sinai icon" width="801" height="1528">
      </section>
      <div class="library-shelf-heading"><h3>From the library</h3><button type="button" data-action="browse">Browse all ${arrow}</button></div>
      <div class="library-work-grid">${featuredBooks.map(book => workCard(book)).join('')}</div>
      <div class="library-collections">${collections.slice(1).map(id => `<button type="button" data-collection="${id}">${labels[id]} ${arrow}</button>`).join('')}</div>`;
  }
  function workResults() {
    const filter = normalize(workQuery);
    const found = works.filter(book => (collection === 'all' || book.corpus === collection ||
      (collection === 'favorites' && favorites.has(book.id))) &&
      (!filter || normalize(`${book.title} ${book.author ?? ''}`).includes(filter)));
    return found.length
      ? `<p class="library-count" role="status">${found.length} ${found.length === 1 ? 'work' : 'works'}</p>
        <div class="library-work-grid">${found.slice(0,limit).map(book => workCard(book,true)).join('')}</div>
        ${found.length > limit ? '<button class="library-more" type="button" data-action="more">Show more works</button>' : ''}`
      : '<p class="library-empty" role="status">No matching works.</p>';
  }
  function browse() {
    return `${heading('Library')}${navigation('browse')}
      <div class="library-filters" aria-label="Library collections">
        ${['all',...collections.slice(1),'favorites'].map(id => `<button type="button" data-collection="${id}" aria-pressed="${collection === id}">${labels[id]}</button>`).join('')}
      </div>
      <label class="library-search">${icons.search}<input type="search" data-work-search aria-label="Find a work or author" placeholder="Find a title or author" value="${escape(workQuery)}" autocomplete="off"></label>
      <div class="library-work-results">${workResults()}</div>`;
  }
  function contents() {
    const info = [['Translator',selected.translator],['Edition',selected.edition]].filter(([,value])=>value);
    return `${heading(selected.title, selected.author)}
      <div class="library-contents"><button type="button" data-action="browse">← Library</button>
      ${info.length ? `<details><summary>About this edition</summary>${info.map(([label,value])=>`<p>${label}: ${escape(value)}</p>`).join('')}</details>` : ''}
      <div class="library-contents-list" aria-label="Chapters">${selected.chapters.slice(0,limit).map(([number,title]) =>
        `<button type="button" data-chapter="${number}"><span>${number}</span>${escape(title || 'Chapter '+number)}${arrow}</button>`).join('')}</div>
      ${selected.chapters.length > limit ? '<button class="library-more" type="button" data-action="more">Show more chapters</button>' : ''}</div>`;
  }
  function matchResults() {
    const entries = matches();
    if (!entries.length) return '<p class="library-empty" role="status">No matching reference.</p>';
    return entries.map((entry,index) => `<button type="button" data-match="${index}" data-active="${index === active}">
       <strong>${escape(entry.chapter ? reference(entry) : entry.book.title)}</strong>
       <small>${entry.chapter ? 'Open passage' : 'Choose chapter'}</small>${index === active ? '<kbd>Enter</kbd>' : arrow}</button>`).join('');
  }
  function bookIndex() {
    return `<section class="library-books" aria-label="Bible books">
      <div class="library-testaments">
        <button type="button" data-testament="old" aria-pressed="${testament === 'old'}">Old Testament</button>
        <button type="button" data-testament="new" aria-pressed="${testament === 'new'}">New Testament</button>
      </div>
      <div class="library-book-list">${scripture.filter(book => canRead(book) && testamentOf(book) === testament).map(book =>
        `<button type="button" data-book="${escape(book.id)}" aria-pressed="${selected === book}">${escape(book.title)} ${arrow}</button>`).join('')}</div>
    </section>`;
  }
  function chapterIndex() {
    const ranges = selected.chapters.find(([number]) => number === chapter)?.[1] ?? [];
    const verses = new Set(ranges.flatMap(([start,end]) => Array.from({length:end-start+1},(_,i) => start+i)));
    const current = scriptureLocation();
    return `<section class="library-chapters" aria-label="Chapter and verse selection">
      <button type="button" class="library-picker-back" data-action="books">← Books</button>
      <div class="library-chapter-heading">
        <div><p class="library-kicker">Choose a chapter</p><h3>${escape(selected.title)}</h3></div>
      </div>
      <div class="library-numbers" aria-label="Chapters">${selected.chapters.map(([number]) => `<button type="button" data-chapter="${number}"
        aria-label="Chapter ${number}" aria-pressed="${chapter === number}" ${current.book === selected && current.chapter === number ? 'aria-current="location"' : ''}>${number}</button>`).join('')}</div>
      <section class="library-verses" aria-label="Verse selection">
        <div class="library-chapter-heading">
          <div><p class="library-kicker">Choose a verse</p><h3>${escape(selected.title)} ${chapter}</h3></div>
          <button type="button" class="library-open-chapter" data-action="open-chapter">Read chapter ${arrow}</button>
        </div>
        <div class="library-numbers" aria-label="Verses">${[...verses].filter(n => n>0).map(number => `<button type="button" data-verse="${number}" aria-label="Verse ${number}">${number}</button>`).join('')}</div>
      </section>
    </section>`;
  }
  function picker() {
    const recents = [...new Map([scriptureLocation(),...recent].map(item=>[reference(item),item])).values()].slice(0,4);
    return `<div class="library-picker-head">${heading('Find a passage', bibleTitle())}
      ${pickerBack ? `<button type="button" class="library-picker-home" data-action="${pickerBack}">← ${pickerBack === 'home' ? 'Your reading' : 'Library'}</button>` : ''}
      <div class="library-picker-fields">
        <label class="library-search">${icons.search}<input type="search" data-reference-search aria-label="Book, chapter, or verse"
          placeholder="Try John 3:16 or Romans 8" value="${escape(passageQuery)}" enterkeyhint="go" autocomplete="off"></label>
      </div>
      <div class="library-picker-options">
        <div class="library-recent" ${passageQuery ? 'hidden' : ''}><span>Recent</span>${recents.map((entry,index)=>`<button type="button" data-recent="${index}">${escape(reference(entry))}</button>`).join('')}</div>
        <label class="library-canon"><span>Canon</span><select aria-label="Bible canon" data-canon>
          ${['Protestant','Catholic','Orthodox'].map((name,i)=>`<option value="${i}" ${canon === i ? 'selected' : ''}>${name}</option>`).join('')}
        </select></label>
      </div></div>
      <div class="library-matches" ${passageQuery ? '' : 'hidden'}>${passageQuery ? matchResults() : ''}</div>
      <div class="library-picker-body" ${passageQuery ? 'hidden' : ''}>
        <div class="library-picker-columns">${bookIndex()}${chapterIndex()}</div>
      </div>`;
  }
  function render(focus) {
    dialog.dataset.screen = screen;
    dialog.dataset.step = step ?? '';
    dialog.innerHTML = screen === 'home' ? home() : screen === 'browse' ? browse() : screen === 'contents' ? contents() : picker();
    if (focus) dialog.querySelector(focus)?.focus({preventScroll:true});
  }
  function show(opener, destination) {
    origin = opener;
    favorites = new Set(model().favoriteWorks);
    if (destination === 'chapter') {
      if (model().scripture) selectPicker('chapters');
      else {
        selected = byId.get(model().book);
        if (!selected) return;
        screen = 'contents';
        limit = 80;
      }
    } else {
      screen = 'home';
    }
    render();
    dialog.showModal();
    dialog.scrollTop = 0;
    const focus = screen === 'picker' && !touchLayout.matches ? '[data-reference-search]' : '.library-close';
    dialog.querySelector(focus)?.focus();
  }
  function selectPicker(initialStep = 'books') {
    pickerBack = ['home','browse'].includes(screen) && dialog.open ? screen : null;
    screen = 'picker';
    canon = model().canon ?? 0;
    const location = scriptureLocation();
    selected = canRead(location.book) ? location.book : scripture[0];
    chapter = location.chapter;
    step = initialStep;
    testament = testamentOf(selected);
    passageQuery = '';
    active = 0;
  }
  function startPicker() {
    selectPicker();
    render(touchLayout.matches ? '.library-close' : '[data-reference-search]');
    dialog.scrollTop = 0;
  }
  function chooseBook(book) {
    selected = book;
    const location = scriptureLocation();
    chapter = location.book === book ? location.chapter : book.chapters[0][0];
    testament = testamentOf(book);
    passageQuery = '';
    step = 'chapters';
    const scroll = dialog.querySelector('.library-book-list')?.scrollTop ?? 0;
    render('[data-chapter]');
    const list = dialog.querySelector('.library-book-list');
    if (list) list.scrollTop = scroll;
    if (touchLayout.matches) dialog.scrollTop = 0;
  }
  function navigate(entry) {
    if (entry.book.corpus === 'scripture') {
      recent = [entry,...recent.filter(item => reference(item) !== reference(entry))].slice(0,4).map(item =>
        ({book:item.book,chapter:item.chapter,verse:item.verse}));
    }
    dialog.close();
    if (entry.id) emit('open-passage',entry.id);
    else emit('open-chapter',String(entry.chapter),entry.book.id,entry.verse ?? 0);
  }
  function openWork(book) {
    const savedLocation = saved(collections.indexOf(book.corpus));
    navigate(savedLocation?.book === book.id
      ? {book,id:savedLocation.id,chapter:savedLocation.chapter}
      : {book,chapter:book.chapters[0][0]});
  }
  function updateMatches() {
    const result = dialog.querySelector('.library-matches');
    result.hidden = !passageQuery;
    dialog.querySelector('.library-picker-body').hidden = Boolean(passageQuery);
    dialog.querySelector('.library-recent').hidden = Boolean(passageQuery);
    result.innerHTML = passageQuery ? matchResults() : '';
  }
  function activateMatch(index) {
    const entry = matches()[index];
    if (entry?.chapter) navigate(entry);
    else if (entry) chooseBook(entry.book);
  }
  dialog.addEventListener('input', event => {
    if (event.target.matches('[data-reference-search]')) {
      passageQuery = event.target.value.trimStart();
      active = 0;
      updateMatches();
    } else if (event.target.matches('[data-work-search]')) {
      workQuery = event.target.value;
      limit = 36;
      dialog.querySelector('.library-work-results').innerHTML = workResults();
    }
  });
  dialog.addEventListener('keydown', event => {
    if (event.isComposing || !event.target.matches('[data-reference-search]') || !passageQuery.trim()) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      activateMatch(active);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const count = matches().length;
      if (!count) return;
      event.preventDefault();
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
      updateMatches();
    }
  });
  dialog.addEventListener('change', event => {
    if (!event.target.matches('[data-canon]')) return;
    canon = Number(event.target.value);
    emit('preference','canon','',canon);
    if (!canRead(selected)) {
      selected = scripture[0];
      chapter = selected.chapters[0][0];
      step = 'books';
      testament = testamentOf(selected);
    }
    active = 0;
    render('[data-canon]');
  });
  dialog.addEventListener('close', () => origin?.focus({preventScroll:true}));
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
      return;
    }
    const button = event.target.closest('button');
    if (!button) return;
    const data = button.dataset;
    if (data.action === 'close') return dialog.close();
    if (data.action === 'continue') return navigate(scriptureLocation());
    if (data.action === 'picker') return startPicker();
    if (data.action === 'home' || data.action === 'browse' || data.collection) {
      screen = data.action === 'home' ? 'home' : 'browse';
      if (data.collection) { collection = data.collection; limit = 36; }
      render(data.collection ? `[data-collection="${CSS.escape(data.collection)}"]` : '.library-close');
      dialog.scrollTop = 0;
      return;
    }
    if (data.action === 'more') {
      const top = dialog.scrollTop;
      limit += 36;
      render('.library-more');
      dialog.scrollTop = top;
      return;
    }
    if (data.action === 'open-chapter') return navigate({book:selected,chapter});
    if (data.action === 'chapters' || data.action === 'books') {
      step = data.action;
      render(step === 'books' ? '[data-testament][aria-pressed=true]' : '[data-chapter]');
      return;
    }
    if (data.book) return chooseBook(byId.get(data.book));
    if (data.testament) {
      testament = data.testament;
      render('[data-testament][aria-pressed=true]');
      return;
    }
    if (data.match !== undefined) return activateMatch(Number(data.match));
    if (data.recent !== undefined) {
      const item = [...new Map([scriptureLocation(),...recent].map(ref=>[reference(ref),ref])).values()][Number(data.recent)];
      return navigate(item);
    }
    if (data.chapter) {
      chapter = Number(data.chapter);
      if (screen !== 'picker') return navigate({book:selected,chapter});
      const scroll = dialog.scrollTop;
      const gridScroll = dialog.querySelector('.library-chapters > .library-numbers').scrollTop;
      render(`[data-chapter="${chapter}"]`);
      dialog.scrollTop = scroll;
      dialog.querySelector('.library-chapters > .library-numbers').scrollTop = gridScroll;
      return;
    }
    if (data.verse) return navigate({book:selected,chapter,verse:Number(data.verse)});
    if (data.work) return openWork(byId.get(data.work));
    if (data.contents) {
      selected = byId.get(data.contents);
      screen = 'contents';
      limit = 80;
      render('.library-close');
      dialog.scrollTop = 0;
      return;
    }
    if (data.favorite) {
      if (favorites.has(data.favorite)) favorites.delete(data.favorite);
      else favorites.add(data.favorite);
      emit('favorite-work','',data.favorite);
      if (collection === 'favorites') {
        dialog.querySelector('.library-work-results').innerHTML = workResults();
        dialog.querySelector('[data-collection="favorites"]').focus({preventScroll:true});
      } else {
        button.setAttribute('aria-pressed',String(favorites.has(data.favorite)));
        button.textContent = favorites.has(data.favorite) ? '★' : '☆';
      }
    }
  });
  const library = document.getElementById('reader-library');
  const title = document.getElementById('reader-jump');
  library.onclick = () => { screen = null; show(library,'home'); };
  title.onclick = () => { screen = null; show(title,'chapter'); };
}
