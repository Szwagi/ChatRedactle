const { invoke } = window.__TAURI__.tauri;
const { listen } = window.__TAURI__.event;

let domNewGame;
let domWikiLists;
let domArticle;
let domGuessTextbox;
let domGuessedWords;
let domAutoNewGame;
let currentGameMode;
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

async function startNewGame() {
    try {
        domNewGame.disabled = true;
        allowGuessing = false;
        clearTimeout(prevAutoNewGameTimeout);

        let elems = document.querySelectorAll(".disable-when-playing");
        for (let e of elems) {
            e.disabled = true;
        }
        domArticle.innerText = "Loading...";
        domGuessedWords.innerText = "";
        
        let list = domWikiLists.value.length != 0 ? domWikiLists.value : null;
        currentGameMode = document.querySelector('input[name="mode"]:checked').value;
        prevWords.clear();

        let titleRaw = await fetchRandomWikiPageTitle(list);
        domArticle.innerHTML = await fetchWikiPageFromTitle(titleRaw);

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

    let elems = document.querySelectorAll(".disable-when-playing");
    for (let e of elems) {
        e.disabled = false;
    }

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
            if (currentGameMode == "normal") {
                e.style.animation = 'flash 2s';
            }
            if (currentGameMode == "blink") {
                e.classList.add("blink");
            }
            else if (currentGameMode == "blind") {
                e.classList.add("redacted-blind");
            }
        }

        // Add word to the list of guessed words
        if (elems.length == 0) {
            let guessedWord = document.createElement("div");
            guessedWord.classList.add("guessed-word");
            guessedWord.classList.add("guessed-word-bad");
            guessedWord.innerText = `${w.unstemmed}`;
            domGuessedWords.prepend(guessedWord);
        }
        else {
            let guessedWord = document.createElement("button");
            guessedWord.classList.add("guessed-word");
            guessedWord.innerText = `${w.unstemmed} (${elems.length})`;
            guessedWord.onclick = () => {
                if (currentGameMode == 'normal') {
                    let elems = document.querySelectorAll(".word--" + w.stemmed);
                    if (elems.length > 0) {
                        elems[0].scrollIntoView();
                    }
                    for (let e of elems) {
                        e.style.animation = 'none';
                        e.offsetHeight;
                        e.style.animation = 'flash-manual 8s';
                    }
                }
            };
            domGuessedWords.prepend(guessedWord);
        }
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
    domGuessTextbox.addEventListener("keydown", e => {
        if (e.code == "Enter") {
            localGuess();
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

    //startNewGame();
});
