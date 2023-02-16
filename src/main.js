const { invoke } = window.__TAURI__.tauri;
const { listen } = window.__TAURI__.event;
const { appWindow } = window.__TAURI__.window;

let domNewGame;
let domWikiLists;
let domArticle;
let domGuessTextbox;
let domGuessedWords;
let domAutoNewGame;
let allowGuessing = false;
let prevWords = new Set();
let prevAutoNewGameTimeout;

async function fetchWikiPageFromTitle(title) {
    return await invoke("fetch_wiki_page_from_title_command", {title});
}
async function fetchRandomWikiPageTitle(list) {
    return await invoke("fetch_random_wiki_page_title_command", {list});
}
async function getWikiLists() {
    return await invoke("get_wiki_lists_command");
}
async function stemAndBase64(word) {
    return await invoke("stem_and_base64_command", {word});
}

listen('twitchwords', e => {
    if (e.payload.length != 0) {
        guessWords(e.payload);
    }
})


function updateDisableWhenPlaying(val) {
    let disableWhenPlaying = document.querySelectorAll(".disable-when-playing");
    for (let e of disableWhenPlaying) {
        e.disabled = val;
    }
}
function updateDisableWhenNotPlaying(val) {
    let disableWhenNotPlaying = document.querySelectorAll(".disable-when-not-playing");
    for (let e of disableWhenNotPlaying) {
        e.disabled = val;
    }
}

async function startNewGame() {
    try {
        if (allowGuessing) {
            endGame(false);
        }

        domNewGame.disabled = true;
        allowGuessing = false;
        clearTimeout(prevAutoNewGameTimeout);

        updateDisableWhenPlaying(true);

        domArticle.innerText = "Loading...";
        domGuessedWords.innerText = "";
        
        let list = domWikiLists.value.length != 0 ? domWikiLists.value : null;
        prevWords.clear();

        let titleRaw = await fetchRandomWikiPageTitle(list);
        domArticle.innerHTML = await fetchWikiPageFromTitle(titleRaw);

        updateDisableWhenNotPlaying(false);

        allowGuessing = true;
    }
    catch (e) {
        allowGuessing = false;
        domArticle.innerText = e.toString();
    }
    finally {
        domNewGame.disabled = false;
    }
}

function endGame(byGiveUp=false) {
    allowGuessing = false;

    if (!byGiveUp && domAutoNewGame.checked) {
        clearTimeout(prevAutoNewGameTimeout);
        prevAutoNewGameTimeout = setTimeout(() => {
            if (domAutoNewGame.checked) {
                startNewGame();
            }
        }, 8000);
    }

    updateDisableWhenPlaying(false);
    updateDisableWhenNotPlaying(true);

    let redacted = document.querySelectorAll(".word");
    for (let e of redacted) {
        e.classList = [];
    }
}

function guessWords(words) {
    if (!allowGuessing) {
        return;
    }

    for (let w of words) {
        if (prevWords.has(w.stemmed)) {
            continue;
        }
        prevWords.add(w.stemmed);

        let elems = document.querySelectorAll(".word--" + w.stemmed);
        for (let e of elems) {
            e.classList.remove("redacted");
            e.animate([
                { background: "var(--accent)" },
                { background: "transparent" }
            ], {
                duration: 2000,
                iterations: 1
            });
        }

        // Add word to the list of guessed words
        let guessedWord = document.createElement("button");
        
        if (elems.length == 0) {
            guessedWord.innerText = w.unstemmed;
            guessedWord.disabled = true;
        }
        else {
            guessedWord.innerText = `${w.unstemmed} (${elems.length})`;
            guessedWord.clickCounter = 0;
            guessedWord.onclick = () => {
                let elems = document.querySelectorAll(".word--" + w.stemmed);
                if (elems.length == 0) return;//?

                guessedWord.clickCounter++;
                let e = elems[guessedWord.clickCounter % elems.length];

                e.scrollIntoView();
                e.animate([
                    { background: "#a54221" },
                    { background: "transparent" }
                ], {
                    duration: 2000,
                    iterations: 1
                });
            };
        }
        domGuessedWords.prepend(guessedWord);
    }

    // Check if we found the word...
    let titleElems = document.querySelectorAll("#the-title .redacted");
    if (titleElems.length == 0) {
        endGame();
    }
}

async function localGuess() {
    let str = domGuessTextbox.value.trim();
    if (str.length == 0) {
        return;
    }
    let split = str.split(/\s+/);
    domGuessTextbox.value = "";
    domGuessTextbox.focus();
    let words = [];
    for (let w of split) {
        words.push({
            stemmed: await stemAndBase64(w),
            unstemmed: w,
        });
    }
    guessWords(words);
}

window.addEventListener("DOMContentLoaded", async () => {
    domNewGame = document.getElementById("new-game");
    domWikiLists = document.getElementById("wiki-list");
    domArticle = document.getElementById("article");
    let domGiveUp = document.getElementById("give-up");
    domGuessTextbox = document.getElementById("guess-textbox");
    let domGuess = document.getElementById("guess");
    domGuessedWords = document.getElementById("guessed-words");
    domAutoNewGame = document.getElementById("auto-new-game");

    domNewGame.addEventListener("click", startNewGame);
    domGiveUp.addEventListener("click", () => endGame(true));
    domGuess.addEventListener("click", localGuess);
    domGuessTextbox.addEventListener("keypress", e => {
        if (e.key == "Enter") {
            localGuess();
        }
    });

    document.addEventListener('keyup', e => {
        if (e.key == "F11") {
            appWindow.setFullscreen(window.innerWidth != screen.width || window.innerHeight != screen.height);
        }
    });

    getWikiLists().then(wikiLists => {
        for (let it of wikiLists) {
            let option = document.createElement("option");
            option.text = it;
            option.value = it;
            domWikiLists.add(option);
        }
    });

    updateDisableWhenPlaying(false);
    updateDisableWhenNotPlaying(true);
});
