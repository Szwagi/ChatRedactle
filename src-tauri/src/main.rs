#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use rand::seq::SliceRandom;
use serde::{Serialize, Deserialize};
use tauri::{Manager, State};
use std::collections::{BTreeMap};
use std::fs::{File};
use std::io::{BufRead, BufReader};
use std::path::Path;
use rust_stemmers::{Algorithm, Stemmer};
use fancy_regex::{Regex, Captures};
use base64::{engine, alphabet::Alphabet, Engine as _};
use twitch_irc::login::StaticLoginCredentials;
use twitch_irc::TwitchIRCClient;
use twitch_irc::{ClientConfig, SecureTCPTransport};
use std::result::Result;
use unidecode::unidecode;

#[derive(Deserialize)]
struct Config {
    channel: String,
}

#[tokio::main]
async fn main() -> tauri::Result<()> {
    let path = Path::new(".").join("lists").join("Video Games");
    let file = File::open(path).map_err(|e| e.to_string()).unwrap();
    let reader = BufReader::new(file);
    let lines: Vec<String> = reader.lines()
        .flat_map(|l| l)
        .filter(|l| l.trim().len() > 0)
        .collect();

    for it in lines {
        let url = format!("https://en.wikipedia.org/w/api.php?prop=extracts&redirects&format=json&action=query&titles={it}");
        let response = reqwest::get(url).await.unwrap().text().await.unwrap();
        if response.contains("redirects") || response.contains("refer to:") || !response.contains("video game") {
            println!("!!! {it}");
        }
    }

    return Ok(());

/*
    let config_file = File::open("config.json")?;
    let config: Config = serde_json::from_reader(config_file)?;
    tauri::Builder::default()
        .manage(Alphabet::new("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_").unwrap())
        .manage(Stemmer::create(Algorithm::English))
        .invoke_handler(tauri::generate_handler![
            fetch_wiki_page_from_title_command,
            fetch_random_wiki_page_title_command,
            get_wiki_lists_command,
            stem_and_base64_command,
        ])
        .setup(|app| {
            let app_handle = app.handle();
            let (mut incoming_messages, client) = 
                TwitchIRCClient::<SecureTCPTransport, StaticLoginCredentials>::new(ClientConfig::default());
            
            tauri::async_runtime::spawn(async move {
                let alphabet = Alphabet::new("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_").unwrap();
                let stemmer = Stemmer::create(Algorithm::English);

                client.join(config.channel).unwrap();
                while let Some(message) = incoming_messages.recv().await {
                    if message.source().command != "PRIVMSG" || message.source().params.len() != 2 {
                        continue;
                    }
                    
                    #[derive(Deserialize, Serialize, Debug)]
                    struct TwitchWord {
                        stemmed: String,
                        unstemmed: String,
                    }
                    let split: Vec<TwitchWord> = message.source().params[1]
                        .split_whitespace()
                        .map(|s| TwitchWord {
                            stemmed: stem_and_base64(s, &stemmer, &alphabet),
                            unstemmed: s.to_owned()
                        })
                        .collect();
                    
                    _ = app_handle.emit_all("twitchwords", &split);
                }
            });
            

            Ok(())
        })
        .run(tauri::generate_context!())?;

    Ok(())
    */
}

fn preprocess_wiki_text(text: &str, stemmer: &Stemmer, alphabet: &Alphabet) -> String {
    // Do not say a single word...
    let annotation_regex = Regex::new(r"<annotation.+\/annotation>").unwrap();
    let word_regex = Regex::new(r"&?(?![^<]*>)([\p{L}0-9']+);?").unwrap();

    let text = annotation_regex.replace_all(&text, "");
    let text = word_regex.replace_all(&text, |caps: &Captures| {
        if caps[0].len() != caps[1].len() + 2 {
            let len = caps[1].chars().count();
            format!("<span title=\"{}\" style=\"--len: {}\" class=\"redacted word word--{}\">{}</span>",
                len,
                len,
                stem_and_base64(&caps[1], stemmer, alphabet),
                &caps[1],
            )
        }
        else {
            caps[0].to_owned()
        }
    });

    text.to_string()
}

fn stem_and_base64(word: &str, stemmer: &Stemmer, alphabet: &Alphabet) -> String {
    let mut decoded = unidecode(word);
    decoded.make_ascii_lowercase();

    let stemmed = stemmer.stem(decoded.as_str()).to_string();
    let config = engine::GeneralPurposeConfig::new().with_encode_padding(false);
    let engine = engine::GeneralPurpose::new(&alphabet, config);
    engine.encode(stemmed)
}

#[tauri::command]
fn stem_and_base64_command(word: &str, stemmer: State<Stemmer>, alphabet: State<Alphabet>) -> String {
    stem_and_base64(word, &stemmer, &alphabet)
}

#[tauri::command]
async fn fetch_wiki_page_from_title_command(title: &str, stemmer: State<'_, Stemmer>, alphabet: State<'_, Alphabet>) -> Result<String, String> {
    #[derive(Serialize, Deserialize)]
    struct Page { title: String, extract: String }
    #[derive(Deserialize)]
    struct Query { pages: BTreeMap<i32, Page> }
    #[derive(Deserialize)]
    struct Response { query: Query }

    // @bug: url injection
    let url = format!("https://en.wikipedia.org/w/api.php?prop=extracts&redirects&format=json&action=query&titles={title}");
    let response: Response = reqwest::get(url).await.map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;
    if let Some(page) = response.query.pages.into_values().next() {
        let pp_title = preprocess_wiki_text(&page.title, &stemmer, &alphabet);
        let pp_extract = preprocess_wiki_text(&page.extract, &stemmer, &alphabet);
        let pp = format!(r#"<h1 id="the-title">{pp_title}</h1>{pp_extract}"#);
        Ok(pp)
    }
    else {
        Err("Something went wrong when fetching the wikipedia page.".to_owned())
    }
}

#[tauri::command]
async fn fetch_random_wiki_page_title_command(list: Option<String>) -> Result<String, String> {
    if let Some(list) = list {
        let path = Path::new(".").join("lists").join(list);
        let file = File::open(path).map_err(|e| e.to_string())?;
        let reader = BufReader::new(file);
        let lines: Vec<String> = reader.lines()
            .flat_map(|l| l)
            .filter(|l| l.trim().len() > 0)
            .collect();

        if let Some(title) = lines.choose(&mut rand::thread_rng()) {
            Ok(title.to_owned())
        }
        else {
            Err("The list is empty.".to_owned())
        }
    }
    else {
        #[derive(Serialize, Deserialize, Debug)]
        struct Random { title: String }
        #[derive(Deserialize, Debug)]
        struct Query { random: Vec<Random> }
        #[derive(Deserialize, Debug)]
        struct Response { query: Query }

        let url = "https://en.wikipedia.org/w/api.php?list=random&rnnamespace=0&rnlimit=1&format=json&action=query";
        let response: Response = reqwest::get(url).await.map_err(|e| e.to_string())?
            .json().await.map_err(|e| e.to_string())?;
        if let Some(random) = response.query.random.first() {
            Ok(random.title.to_owned())
        }
        else {
            Err("Something went wrong when fetching a random wikipedia page title.".to_owned())
        }
    }
}

#[tauri::command]
fn get_wiki_lists_command() -> std::result::Result<Vec<String>, String> {
    Ok(std::fs::read_dir("lists").map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|e| e.path().is_file())
        .filter_map(|e| {
            e.path()
                .file_name()
                .and_then(|s| s.to_str())
                .map(|s| s.to_owned())
        })
        .collect())
}
