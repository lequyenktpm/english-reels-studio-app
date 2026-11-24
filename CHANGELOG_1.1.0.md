# English Reels Studio 1.1.0

## Sửa lỗi và cải thiện

- ElevenLabs: dùng MP3 `mp3_44100_128`, chuyển nội bộ sang WAV; lấy character alignment để đồng bộ karaoke khi API hỗ trợ.
- ElevenLabs: thêm kiểm tra API Key và tải danh sách voice thực sự truy cập được từ tài khoản; bỏ voice ID Rachel/Adam cố định.
- ElevenLabs: hiển thị thông báo lỗi dễ hiểu cho API Key, quota/credit, quyền truy cập, Voice ID và rate limit.
- Bộ tách nội dung: không còn tự động loại câu đầu tiên của bài đọc chỉ vì nó ngắn; chỉ loại tiêu đề khi nhận diện rõ hoặc trùng chính xác tiêu đề trang.
- Bộ tách quiz: nhận diện thêm các cách viết tiêu đề câu hỏi phổ biến và giữ phần đọc, câu hỏi, đáp án theo thứ tự.
- Gemini: tăng yêu cầu giữ nguyên văn nội dung tiếng Anh; kiểm tra mức độ bao phủ từ khóa và thứ tự cụm từ, phát hiện phản hồi bị cắt, thông báo khi thiếu API Key hoặc phải chuyển sang parser dự phòng.
- Batch: hiển thị cảnh báo về chế độ AI/parser dự phòng thay vì bỏ qua thông tin đó.
- Preview: đồng bộ karaoke từng từ với audio; dừng audio cũ khi chuyển sang thẻ khác.
- Video: thêm câu dẫn bằng giọng đọc khi chuyển giữa các đoạn đọc, sang câu hỏi và đáp án; xuất karaoke từng từ burn-in trong MP4.

## Giới hạn đã biết

- Không kiểm chứng được quyền truy cập ElevenLabs bằng API Key cá nhân của người dùng trong môi trường build.
- Karaoke với Piper và đường TTS dự phòng sử dụng ước lượng theo độ dài từ/dấu câu, không chính xác như character alignment do ElevenLabs trả về.
