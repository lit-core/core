use clap::{Parser, Subcommand};
use css_fuse::models::FuseConfig;
use css_fuse::run_fuse_pipeline;

#[derive(Parser)]
#[command(name = "css-fuse")]
#[command(about = "AOT Constructable Stylesheet Deduplication Engine for Web Components", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    /// File patterns to include
    #[arg(short, long, value_delimiter = ' ')]
    include: Option<Vec<String>>,

    /// File patterns to exclude
    #[arg(short, long, value_delimiter = ' ')]
    exclude: Option<Vec<String>>,

    /// Minimum components to trigger deduplication [default: 2]
    #[arg(short, long)]
    threshold: Option<u32>,

    /// Output directory for fused sheets [default: .fused]
    #[arg(short, long)]
    output_dir: Option<String>,

    /// Write changes to disk
    #[arg(short, long)]
    write: bool,

    /// Output JSON format
    #[arg(long)]
    json: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Deduplicate CSS across Lit components
    Fuse {
        #[arg(short, long)]
        write: bool,
    },
    /// Audit Shadow DOM scoping and CSS custom property contracts
    Audit,
    /// Print deduplication statistics without modifying files
    Stats,
}

fn main() {
    let cli = Cli::parse();

    let config = FuseConfig {
        include: cli.include,
        exclude: cli.exclude,
        files: None,
        threshold: cli.threshold,
        output_dir: cli.output_dir,
        write: Some(cli.write),
        virtual_imports: None,
        min_savings: None,
    };

    match cli.command {
        Some(Commands::Audit) => {
            let result = run_fuse_pipeline(&config, true);
            if cli.json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&result.diagnostics).unwrap()
                );
            } else {
                println!("\n🔍 Lit CSS Fuse — Shadow DOM Scoping & Contract Audit");
                println!("=====================================================");
                if result.diagnostics.is_empty() {
                    println!("✓ No scoping or contract violations found across components.");
                } else {
                    for diag in &result.diagnostics {
                        let symbol = if diag.severity == "error" {
                            "✖"
                        } else {
                            "⚠"
                        };
                        println!(
                            "{} [{}] {}: {}",
                            symbol,
                            diag.code,
                            diag.file_path.as_deref().unwrap_or("unknown"),
                            diag.message
                        );
                    }
                    println!("\nTotal diagnostics: {}", result.diagnostics.len());
                }
            }
        }
        Some(Commands::Stats) => {
            let result = run_fuse_pipeline(&config, true);
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&result.stats).unwrap());
            } else {
                println!("\n📊 Lit CSS Fuse — Deduplication Analytics");
                println!("==========================================");
                println!("Files scanned:          {}", result.stats.files_scanned);
                println!("Styles extracted:       {}", result.stats.styles_extracted);
                println!("Total CSS rules:        {}", result.stats.total_rules);
                println!("Unique CSS rules:       {}", result.stats.unique_rules);
                println!("Rules deduplicated:     {}", result.stats.rules_deduped);
                println!(
                    "Fused sheets created:   {}",
                    result.stats.fused_sheets_created
                );
                println!(
                    "Components affected:    {}",
                    result.stats.components_rewritten
                );
                println!(
                    "Estimated bytes saved:  {} B (~{:.1} KB)",
                    result.stats.bytes_saved,
                    result.stats.bytes_saved as f64 / 1024.0
                );
            }
        }
        Some(Commands::Fuse { write }) => {
            let mut run_cfg = config.clone();
            run_cfg.write = Some(write || cli.write);
            let result = run_fuse_pipeline(&run_cfg, !run_cfg.write.unwrap_or(false));
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&result).unwrap());
            } else {
                println!("\n⚡ Lit CSS Fuse — Deduplication Complete");
                println!("=========================================");
                println!(
                    "Fused {} rules into {} shared sheets across {} components.",
                    result.stats.rules_deduped,
                    result.stats.fused_sheets_created,
                    result.stats.components_rewritten
                );
                if run_cfg.write.unwrap_or(false) {
                    println!("✓ Written fused sheets to disk.");
                } else {
                    println!("ℹ Dry run: omitted file writes. Use '--write' to apply changes.");
                }
            }
        }
        None => {
            let result = run_fuse_pipeline(&config, !cli.write);
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&result).unwrap());
            } else {
                println!("\n⚡ Lit CSS Fuse — Deduplication Summary");
                println!("=======================================");
                println!(
                    "Scanned {} files, found {} rules ({} unique).",
                    result.stats.files_scanned, result.stats.total_rules, result.stats.unique_rules
                );
                println!(
                    "Fused {} duplicate rules into {} shared sheets.",
                    result.stats.rules_deduped, result.stats.fused_sheets_created
                );
                if !result.diagnostics.is_empty() {
                    println!(
                        "\nScoping & Contract Diagnostics: {}",
                        result.diagnostics.len()
                    );
                    for diag in result.diagnostics.iter().take(5) {
                        println!("  • [{}] {}", diag.code, diag.message);
                    }
                    if result.diagnostics.len() > 5 {
                        println!(
                            "  ... and {} more. Run 'css-fuse audit' for full list.",
                            result.diagnostics.len() - 5
                        );
                    }
                }
            }
        }
    }
}
