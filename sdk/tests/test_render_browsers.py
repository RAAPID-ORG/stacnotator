import pytest

from stacnotator._render_browsers import estimate_render_capacity


@pytest.mark.parametrize(
    ("cpu_count", "available_memory_mb", "pages"),
    [
        (4, 6144, 3),  # laptop: bound by cores, one kept free
        (22, 12288, 14),  # workstation: 7.3 GB usable fits 14 pages, cores allow 21
        (22, 4096, 4),  # workstation short on memory: 2 GB after the reserve
        (1, 1024, 1),  # never below one page
    ],
)
def test_estimate_render_capacity(cpu_count, available_memory_mb, pages):
    assert estimate_render_capacity(cpu_count, available_memory_mb) == pages
