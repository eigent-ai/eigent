from app.run_journal import SQLiteRunJournal


def test_refused_run_replays_reason_and_releases_the_lane(tmp_path):
    journal = SQLiteRunJournal(tmp_path / "journal.db")
    journal.ensure_run(
        run_id="refused", project_id="session", status="pending"
    )
    assert journal.reject_unstarted_run(
        "refused", project_id="session", message="Unsupported thinking effort"
    )
    assert journal.get_run("refused").status == "failed"
    event = journal.list_events("refused")[0]
    assert event.event_type == "run.failed" and event.legacy_step == "error"
    assert event.payload["message"] == "Unsupported thinking effort"
    assert not journal.reject_unstarted_run(
        "refused", project_id="session", message="duplicate"
    )
    journal.ensure_run(run_id="next", project_id="session", status="pending")
    journal.create_run_attempt(
        "next", request_id="next", reason="initial_execution"
    )
    assert journal.get_active_project_run("session").run_id == "next"


def test_rejection_cannot_close_an_admitted_or_foreign_run(tmp_path):
    journal = SQLiteRunJournal(tmp_path / "journal.db")
    journal.ensure_run(run_id="run", project_id="session", status="pending")
    assert not journal.reject_unstarted_run(
        "run", project_id="other", message="bad"
    )
    journal.create_run_attempt(
        "run", request_id="run", reason="initial_execution"
    )
    assert not journal.reject_unstarted_run(
        "run", project_id="session", message="bad"
    )
    assert journal.get_run("run").status == "pending"
