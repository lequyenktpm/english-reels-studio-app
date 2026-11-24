# English Reels Studio

Ứng dụng web chạy local: dán link bài học (ví dụ `english-practice.net`) hoặc dán text → bóc nội dung thành thẻ → chỉnh sửa → nghe thử có karaoke trực tiếp → xuất video `.mp4` có karaoke từng từ và phụ đề `.srt`.

## Chạy ứng dụng

Yêu cầu: Node.js 20 trở lên và kết nối Internet ở lần cài đầu để tải dependencies/font/giọng Piper.

```bash
bash start.sh
```

Mở trình duyệt tại `http://localhost:3000`.

## Tách nội dung bằng Gemini AI

1. Đánh dấu **Dùng Gemini AI tách thẻ thông minh**.
2. Nhập Gemini API Key ở ô bên dưới.
3. Chọn kiểu nội dung `Auto`, `Quiz`, `Vocabulary` hoặc `Reading`, sau đó bấm **Phân tích text → Tạo thẻ** hoặc **Lấy nội dung**.

Nếu chưa có Gemini API Key, ứng dụng sẽ báo rõ rằng đang dùng bộ tách theo quy tắc (`rules`), không giả vờ đã gọi AI. Khi Gemini trả về thiếu hoặc đảo sai nội dung, ứng dụng kiểm tra độ bao phủ từ khóa, thứ tự cụm từ và câu nguồn; nếu chất lượng không đạt, ứng dụng chuyển sang bộ tách dự phòng và hiển thị cảnh báo. Các nội dung dài hơn 30.000 ký tự hoặc phản hồi bị Gemini cắt do giới hạn token cũng được báo rõ để tránh âm thầm mất phần cuối.

Bộ tách quy tắc được cải thiện để giữ nguyên câu đầu tiên của đoạn đọc: ứng dụng chỉ bỏ dòng đầu như tiêu đề khi có nhãn rõ ràng (ví dụ `Reading Exercise: ...`, `Exercise 1: ...`) hoặc dòng đó trùng chính xác tiêu đề trang. Những tiêu đề câu hỏi như `True or False`, `Answer these questions`, `Read the passage and answer...` được nhận diện để chia đoạn đọc, câu hỏi và đáp án.

## ElevenLabs TTS

1. Nhập ElevenLabs API Key.
2. Bấm **Kiểm tra key & tải giọng**.
3. Chọn một giọng trong danh sách lấy trực tiếp từ tài khoản của bạn.
4. Bấm **Nghe thẻ này** hoặc tạo video.

Ứng dụng không còn mặc định chọn voice ID Rachel/Adam cố định; điều này tránh trường hợp voice không có trong thư viện hoặc không được key hiện tại truy cập. TTS dùng endpoint có alignment để lấy audio và mốc thời gian từng ký tự, yêu cầu MP3 `mp3_44100_128`, rồi chuyển nội bộ sang WAV cho pipeline render. Nếu endpoint alignment không khả dụng, ứng dụng thử endpoint TTS MP3 tiêu chuẩn và ước lượng thời gian từ độ dài từ. Lỗi key, quota/credit, quyền truy cập, voice ID và giới hạn tốc độ được hiển thị theo mã lỗi API.

Không đưa API Key cho người khác. Key được lưu tạm trong `localStorage` của trình duyệt trên máy đang chạy ứng dụng.

## Karaoke và chuyển đoạn

- **Nghe thẻ này:** karaoke hiển thị ngay trong trang preview và tô sáng từ theo thời điểm audio đang phát; kéo thanh audio sẽ cập nhật karaoke theo vị trí mới.
- **Video MP4:** bật tùy chọn **Hiện karaoke tô sáng từng từ trong video** để burn-in phụ đề karaoke vào video.
- Khi chuyển từ tiêu đề sang đoạn đọc, giữa các đoạn đọc, sang câu hỏi hoặc sang đáp án, lời đọc có câu dẫn chuyển tiếp bằng tiếng Anh (ví dụ “Let's continue with the next part”, “Now, let's move on to question...”, “Let's check the answer”).
- Với ElevenLabs, từ được căn theo alignment API. Với Piper/giọng dự phòng không có alignment, thời gian karaoke được ước lượng theo độ dài từ và dấu câu, nên có thể lệch nhẹ so với phát âm thực tế.
- Khi chọn thẻ khác trong danh sách, audio đang nghe sẽ dừng để tránh karaoke hiển thị một thẻ trong khi âm thanh vẫn đọc thẻ trước.

## Tính năng chính

- Bóc nội dung từ URL, lọc phần điều hướng/quảng cáo, phát hiện trang mục lục và danh sách bài tập con.
- Nhận diện các dạng bài reading, quiz True/False / comprehension và vocabulary.
- Chỉnh sửa, thêm, xóa, nhân bản và sắp xếp thẻ; điền bản dịch nếu cần.
- Nghe thử từng thẻ trước khi render.
- Xuất MP4 dọc, phụ đề SRT và phụ đề dịch (nếu có bản dịch).
- Render theo batch từ danh sách bài tập hoặc nhiều bài trong một trang.

## Lưu ý

- Gemini và ElevenLabs là dịch vụ bên ngoài, cần API Key hợp lệ và có quota/quyền phù hợp. Không có API Key thì Gemini dùng parser quy tắc; ElevenLabs không thể tạo tiếng đọc.
- Piper là lựa chọn TTS cục bộ. Lần chạy đầu ứng dụng có thể tải Piper binary và model giọng.
- Karaoke của Piper là ước lượng, không phải forced alignment. Căn thời gian chính xác nhất cần giọng ElevenLabs có trả về alignment.
