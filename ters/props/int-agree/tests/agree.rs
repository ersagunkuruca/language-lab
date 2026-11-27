// Property: `ters run` (the evaluator) and `ters compile` (core IR to JS)
// print the same for any Int expression. k is 1 at run time but unknown to
// the compiler, so nothing folds away.
use ephyra::{Config, GenExt, Source};
use std::io::{BufRead, BufReader, Write};
use std::ops::ControlFlow;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;

#[derive(Clone, Debug)]
enum E { Lit(i64), K, Bin(char, Box<E>, Box<E>), Div(bool, Box<E>, Box<E>) }

fn text(e: &E) -> String {
    match e {
        E::Lit(n) if *n < 0 => format!("({n})"),
        E::Lit(n) => n.to_string(),
        E::K => "k".into(),
        E::Bin(op, a, b) => format!("({} {op} {})", text(a), text(b)),
        E::Div(q, a, b) => format!("first({}({}, {}), else 99)", if *q { "quotient" } else { "remainder" }, text(a), text(b)),
    }
}

fn lit(g: &mut Source) -> i64 {
    if g.bool_with(0.3) { *g.pick(&[0, 1, -1, 2, 4611686018427387903, -4611686018427387904, i64::MAX, i64::MIN + 1]) } else { g.int(-20i64..=20) }
}
fn expr(g: &mut Source, depth: u32) -> E {
    if depth == 0 || g.bool_with(0.3) { return if g.bool_with(0.3) { E::K } else { E::Lit(lit(g)) }; }
    let (a, b) = (Box::new(expr(g, depth - 1)), Box::new(expr(g, depth - 1)));
    match g.int(0u32..=4) { 0 => E::Bin('+', a, b), 1 => E::Bin('-', a, b), 2 => E::Bin('*', a, b), 3 => E::Div(true, a, b), _ => E::Div(false, a, b) }
}
fn shrink(e: &E, visit: &mut dyn FnMut(E) -> ControlFlow<()>) -> ControlFlow<()> {
    match e {
        E::Lit(n) if *n != 0 => { visit(E::Lit(0))?; if n.abs() > 1 { visit(E::Lit(n / 2))?; } }
        E::K => visit(E::Lit(1))?,
        E::Bin(op, a, b) => {
            visit((**a).clone())?; visit((**b).clone())?;
            shrink(a, &mut |a2| visit(E::Bin(*op, Box::new(a2), b.clone())))?;
            shrink(b, &mut |b2| visit(E::Bin(*op, a.clone(), Box::new(b2))))?;
        }
        E::Div(q, a, b) => {
            visit((**a).clone())?; visit((**b).clone())?;
            shrink(a, &mut |a2| visit(E::Div(*q, Box::new(a2), b.clone())))?;
            shrink(b, &mut |b2| visit(E::Div(*q, a.clone(), Box::new(b2))))?;
        }
        _ => {}
    }
    ControlFlow::Continue(())
}

struct Worker { _c: Child, i: ChildStdin, o: BufReader<ChildStdout> }
static WORKER: Mutex<Option<Worker>> = Mutex::new(None);
fn ask(main: &str) -> serde_json::Value {
    let mut w = WORKER.lock().unwrap_or_else(|e| e.into_inner());
    let w = w.get_or_insert_with(|| {
        let mut c = Command::new("node").arg(concat!(env!("CARGO_MANIFEST_DIR"), "/../worker.ts"))
            .stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
        Worker { i: c.stdin.take().unwrap(), o: BufReader::new(c.stdout.take().unwrap()), _c: c }
    });
    writeln!(w.i, "{}", serde_json::json!({ "main": main })).unwrap();
    let mut line = String::new();
    w.o.read_line(&mut line).unwrap();
    serde_json::from_str(&line).unwrap()
}

#[test]
fn evaluator_and_compiled_js_agree() {
    let exprs = (|g: &mut Source| expr(g, 3)).with_shrink(shrink).boxed();
    let tests = std::env::var("EPHYRA_TESTS").ok().and_then(|s| s.parse().ok()).unwrap_or(30);
    ephyra::check(&Config::default().tests(tests).name("evaluator_and_compiled_js_agree"), exprs, |e: E| {
        let main = format!("k = length(append([\"a\"], arguments)); print(show({}))", text(&e));
        let r = ask(&main);
        assert!(r.get("error").is_none(), "worker: {r}");
        assert_eq!(r["run"], r["compiled"], "for {main}");
        if std::env::var("NATIVE").is_ok() { assert_eq!(r["run"], r["native"], "native, for {main}"); }
    }).assert_passed();
}
