use clap::{Parser, Subcommand};
use html_fuse::models::HtmlFuseConfig;
use html_fuse::{analyze, audit_templates, fuse};
use std::process;

#[derive(Parser)]
#[command(name = "html-fuse")]
#[command(about = "Cross-component static template and SVG fragment clustering for Lit", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Fuse {
        #[arg(short, long, help = "Glob patterns to include")]
        include: Option<Vec<String>>,

        #[arg(short, long, help = "Glob patterns to exclude")]
        exclude: Option<Vec<String>>,

        #[arg(short, long, default_value_t = 2, help = "Sharing threshold")]
        threshold: u32,

        #[arg(short, long, default_value = ".fused-html", help = "Output directory")]
        output_dir: String,

        #[arg(short, long, default_value_t = true, help = "Write output files to disk")]
        write: bool,

        #[arg(short, long, default_value_t = 15, help = "Minimum fragment length")]
        min_length: u32,
    },
    Analyze {
        #[arg(short, long, help = "Glob patterns to include")]
        include: Option<Vec<String>>,

        #[arg(short, long, help = "Glob patterns to exclude")]
        exclude: Option<Vec<String>>,

        #[arg(short, long, default_value_t = 2, help = "Sharing threshold")]
        threshold: u32,
    },
    Audit {
        #[arg(short, long, help = "Glob patterns to include")]
        include: Option<Vec<String>>,

        #[arg(short, long, help = "Glob patterns to exclude")]
        exclude: Option<Vec<String>>,
    },
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Fuse {
            include,
            exclude,
            threshold,
            output_dir,
            write,
            min_length,
        } => {
            let config = HtmlFuseConfig {
                include,
                exclude,
                threshold: Some(threshold),
                output_dir: Some(output_dir),
                write: Some(write),
                min_fragment_length: Some(min_length),
                ..Default::default()
            };

            let result = fuse(Some(config));
            println!("⚡ [html-fuse] Optimization completed!");
            println!("  Templates scanned:        {}", result.stats.templates_scanned);
            println!("  Fragments extracted:      {}", result.stats.fragments_extracted);
            println!("  Unique fragments:         {}", result.stats.unique_fragments);
            println!("  Duplicate fragments fused:{}", result.stats.fragments_deduped);
            println!("  Shared templates created: {}", result.stats.fused_templates_created);
            println!("  Components rewritten:     {}", result.stats.components_rewritten);
            println!("  Est. bytes saved:         {} B", result.stats.bytes_saved);
        }
        Commands::Analyze {
            include,
            exclude,
            threshold,
        } => {
            let config = HtmlFuseConfig {
                include,
                exclude,
                threshold: Some(threshold),
                write: Some(false),
                ..Default::default()
            };

            let result = analyze(Some(config));
            println!("📊 [html-fuse] Analysis summary:");
            println!("  Files scanned:            {}", result.stats.files_scanned);
            println!("  Templates scanned:        {}", result.stats.templates_scanned);
            println!("  Fragments extracted:      {}", result.stats.fragments_extracted);
            println!("  Duplicate fragments fused:{}", result.stats.fragments_deduped);
            println!("  Shared templates created: {}", result.stats.fused_templates_created);
        }
        Commands::Audit { include, exclude } => {
            let config = HtmlFuseConfig {
                include,
                exclude,
                ..Default::default()
            };

            let diagnostics = audit_templates(Some(config));
            if diagnostics.is_empty() {
                println!("✓ [html-fuse] No template warnings found.");
            } else {
                for d in &diagnostics {
                    println!("[{}] {}: {}", d.severity, d.code, d.message);
                }
                process::exit(1);
            }
        }
    }
}
